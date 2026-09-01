# Patch Manager

A Windows desktop application (Electron + React + SQLite) for managing software patches received via Microsoft Outlook. It automates the full patch lifecycle: fetching emails, extracting and classifying files, detecting deployment paths, merging configuration files, deploying to application servers, and restarting Tomcat.

---

## Table of Contents

- [Overview](#overview)
- [Application Management](#application-management)
- [Email Fetching](#email-fetching)
- [Patch Processing](#patch-processing)
- [Deployment Modes](#deployment-modes)
- [Patch Inbox](#patch-inbox)
- [Deployment Flow](#deployment-flow)
- [Merge Engine](#merge-engine)
- [WAR Deploy (SFTP)](#war-deploy-sftp)
- [Tomcat Restart](#tomcat-restart)
- [Server Reachability](#server-reachability)
- [Auto-Detect Status](#auto-detect-status)
- [Deployment Log](#deployment-log)
- [Auto-Update](#auto-update)
- [System Tray](#system-tray)
- [Settings](#settings)
- [Logging](#logging)
- [Database](#database)

---

## Overview

Patch Manager connects to Microsoft Outlook via PowerShell COM automation, scans a designated Outlook folder for patch emails, downloads attachments, classifies every file by type, auto-detects deployment paths from email body and archive structure, and provides a one-click deploy flow. Multiple applications (each mapped to its own Outlook folder and server) can be managed simultaneously.

---

## Application Management

Each **App** represents one deployable application (e.g., AICLCONVUAT, AICL-BILLER). Every app stores:

| Field | Description |
|---|---|
| Name | Unique display name |
| Deployment Mode | `smb`, `rdp_assisted`, or `sftp` |
| Outlook Folder Path | `StoreName/Inbox/FolderName` — folder scanned for patch emails |
| App Root Path | Root path on server (relative paths are joined to this) |
| SMB Path | UNC path (`\\server\share\appfolder`) for SMB/RDP modes |
| Server Host | Hostname or IP for SFTP/RDP-WMI modes |
| Server Port | SSH port (default 22) |
| Server User / Password | Credentials for SSH or net use authentication |
| Server Key Path | Optional private key file for SSH key auth |
| Tomcat Service Name | Windows service name or Linux service for restart |
| Tomcat Restart Command | Custom restart command (overrides default systemctl/service) |
| Tomcat Run As User | `sudo su - <user>` wrapper for restart (e.g., `oracle`) |
| Tomcat Remote Path | Path to Tomcat bin directory for shutdown/startup scripts |
| Local Source Path | Local folder used as WAR build source (SFTP mode) |
| WAR Name | Name without `.war` extension for WAR deploy |
| Patch Path | UNC path where patch folders are saved (defaults to global setting) |
| Notes | Free-text notes |

Apps can be added, edited, and soft-deleted. The sidebar lists all active apps.

---

## Email Fetching

### Outlook Integration

Outlook is automated via PowerShell COM (`New-Object -ComObject Outlook.Application`). The PowerShell script runs out-of-process to avoid blocking the Electron main thread.

**32-bit / 64-bit fallback:** If 64-bit `powershell.exe` fails with `OUTLOOK_NOT_RUNNING` (COM bitness mismatch), the app automatically retries with `C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe`.

### Fetch Dialog

- Select one or more apps to fetch for.
- Choose a **date range** (Since / To). The app tracks the last fetch date and pre-fills it.
- Emails are filtered server-side using a DASL `Items.Restrict` query on `urn:schemas:httpmail:datereceived`, which is significantly faster than scanning all items.
- A fallback full scan is used if Restrict fails.

### Email Body Extraction

The email body is sanitized (control characters stripped, whitespace collapsed, capped at 4,000 characters) and used for:
- **Path detection** — UNC paths, folder names, relative paths
- **SQL extraction** — SQL statements inline in the body
- **XML extraction** — `<servlet>` and `<servlet-mapping>` blocks for web.xml merge

Quoted reply content (lines after "From:", "-----Original Message-----", or `____` dividers) is stripped before extraction so only the latest email in a thread is processed.

---

## Patch Processing

### Attachment Classification

Every attachment is classified into one of these types:

| Type | Description |
|---|---|
| `jsp` | JSP page files |
| `js_file` | JavaScript files |
| `xml_merge` | XML configuration files (web.xml) — merged, not replaced |
| `props_merge` | Java `.properties` files (labels, config) — merged |
| `db_script` | SQL files and text files containing SQL |
| `gias_patch` | GIAS RAR archives (full app patch bundles) |
| `inspect_archive` | ZIP/RAR archives containing multiple files of mixed types |
| `reference` | Documents, PDFs, and other non-deployable files |
| `image` | Images — silently ignored |

### Deploy Path Detection

For each file, the app attempts to determine the deployment path using (in order of priority):

1. **Known fixed rules** — `log4j2.properties` always maps to `WEB-INF/classes/log4j2.properties`; labels files map to `WEB-INF/classes/geninslib/rb/`
2. **Archive subfolder structure** — if a file is inside a subdirectory within the archive (e.g., `di/imageview.jsp`), the relative path within the archive is used directly
3. **Email body path detection** — UNC paths, Windows paths, and partial paths mentioned in the email text

The detected path is joined with the app's base path (`smb_path` or `app_root_path`) unless it is already absolute.

If confidence is low or no path is found, a **Manual Path Dialog** is shown to the user after fetch completes.

### SQL Extraction

SQL statements are extracted from:
- The email body (after stripping quoted replies)
- Text/script attachments
- Text files inside inspect archives

Extracted statements are formatted (single-line, semicolon-terminated) and compiled into a single `compiled_scripts.txt` file per patch. This file is shown in the inbox with a "View Script" button. On re-fetch of a duplicate email, the compiled script is regenerated with the latest extraction logic.

DB scripts are always marked `skipped` for auto-deployment — they must be applied manually by a DBA.

### web.xml Body Extraction

`<servlet>` and `<servlet-mapping>` XML blocks found in the email body are saved as `body_webxml_entries.txt` with type `xml_merge`, targeting `WEB-INF/web.xml`. This is merged like any other XML merge file.

### GIAS Archives

GIAS RAR archives are extracted on fetch. On deploy, the app strips a single top-level wrapper folder (e.g., `GIAS_Reserved_Folders`) if present but preserves structural web-app directories (`WEB-INF`, `META-INF`, `classes`, `lib`, etc.). Files are then copied relative to the app root.

### Inspect Archives

ZIP/RAR archives not recognized as GIAS patches are extracted and each inner file is classified individually. Files inside subdirectories use the archive's folder structure to infer their deploy path.

### Duplicate Detection

Emails are deduplicated by Outlook `EntryId`. If an email was already processed, only the compiled SQL script is regenerated — no new patch record or files are created.

---

## Deployment Modes

### SMB (Direct Share)

Files are copied directly over a Windows UNC share path (`\\server\share\...`). No SSH involved. Tomcat is restarted via `Restart-Service` PowerShell on the local or shared machine.

### RDP-Assisted

Same as SMB for file copy (UNC path). Tomcat restart uses **WMI over DCOM** (port 135) via `Get-WmiObject`/`Win32_Service` — no RDP session required. The target machine needs `LocalAccountTokenFilterPolicy=1` and WMI firewall rules enabled.

WMI restart sequence:
1. `StopService()` — waits up to 15 seconds for graceful stop
2. If still running: kills the process tree (service PID + child JVM) and any remaining `Tomcat*`/`java.exe` processes via WMI
3. `StartService()`

### SFTP

Files are uploaded to a Linux server over SSH/SFTP. Deployment is in two stages:
1. **Patch file deploy** — copies files into a local source folder (`local_src_path`) that mirrors the exploded WAR
2. **WAR deploy** — zips `local_src_path` into a `.war` and uploads it to the server via SFTP

For SFTP, an automatic backup of the existing remote WAR is created before upload, named with the date of the last deployed patch (e.g., `CONVUAT bk 21-Aug-26.war`).

---

## Patch Inbox

The inbox lists all patches for the selected app, with tabs:
- **Pending** — staged patches awaiting deployment
- **Deployed** — patches marked as deployed
- **All** — all patches

Each patch row shows:
- Email subject, sender, date/time
- File type summary and count
- Ticket reference (e.g., `JIRA-123`) extracted from subject
- Status badge
- Warning icon if any file is missing a deployment path

Expanding a patch row shows:
- Individual file rows with type badge, filename, deploy path, and status
- **Set Path** inline editor for files needing a manual path
- **Preview Merge** button for XML/properties files
- **View Script** button for compiled SQL scripts
- **Deploy…** button
- **Mark as Deployed** button (for patches already deployed externally)
- **Open Folder** button to open the patch's local folder

### Toolbar

- **Fetch Emails** — opens the fetch dialog
- **Detect Status** — runs auto-detection for all staged patches
- **Deploy WAR** — builds and uploads the WAR (SFTP mode)
- **Restart Tomcat** — triggers Tomcat restart for the app
- **Refresh** — re-checks server reachability and reloads patches
- **Archive All** button — archives all deployed patches

All server-side actions (Detect Status, Deploy WAR, Restart Tomcat, Fetch Emails, Deploy, Merge) are automatically **disabled** when the server is offline.

---

## Deployment Flow

Clicking **Deploy…** opens a preview dialog showing:
- **Deployable files** — files that will be copied, with destination path and mtime comparison
- **Non-deployable files** — with reason (already deployed, skipped, no path set, DB script, app file is newer)
- **Re-deploy checkbox** — force-deploys files where the app copy is newer
- **Restart Tomcat checkbox** — optionally restart after deploy
- **Blocker warning** — if older undeployed patches exist for the same app, deploy is blocked until they are deployed first (enforces chronological order)

After confirmation, files are copied (or uploaded via SFTP) and statuses updated. If all files in a patch are deployed or skipped, the patch status becomes `deployed`.

### Credential Hint (RDP-Assisted)

For RDP-Assisted apps, the deploy preview dialog shows the server credentials so the user can log in manually if needed.

---

## Merge Engine

### XML Merge (web.xml)

Adds new `<servlet>` and `<servlet-mapping>` entries to an existing `web.xml`. Entries already present (matched by `<servlet-name>`) are skipped. The merged file is written back to the server. A safety check rejects the merge if the result is less than 50% the size of the original.

### Properties Merge

Adds new key-value pairs from the patch file into the server's `.properties` file. Keys already present are skipped.

**Multi-file merge:** When the deploy target is a directory (e.g., `rb/`), the merge is applied to **every** `.properties` file in that directory — covering all locale bundles simultaneously.

### File Resolution

When the deploy path is a directory, the engine finds the best-matching file by:
1. Case-insensitive exact filename match
2. Scored fuzzy match on base name (handles `labels.txt` → `LabelsBundle.properties`, cross-extension matching)

### Safety Checks

- Patch file must not be empty
- Server file must not be empty (read failure or empty = abort)
- Result must be ≥ 50% the size of the existing server file
- SFTP: a `.bak-<timestamp>` backup is created on the server before writing
- SMB: writes directly (filesystem backup is at OS level)

### Preview Merge Dialog

Shows a diff-style preview of what will be added before applying. The user can review, then click **Apply Merge** to write to server.

---

## WAR Deploy (SFTP)

1. **Build WAR** — zips the contents of `local_src_path` into `<war_name>.war` using a worker thread (non-blocking)
2. **Backup existing WAR** — renames `<war_name>.war` on the remote server to `<war_name> bk <date>.war`
3. **Upload** — uploads the new WAR via SFTP `fastPut` with real-time progress (shown in steps + percentage)

Progress updates are streamed to the UI via `war:progress` IPC events.

---

## Tomcat Restart

| Mode | Method |
|---|---|
| SMB | `net stop` / `net start` via `cmd.exe` |
| RDP-Assisted | WMI `Win32_Service.StopService()` / `StartService()` over DCOM |
| SFTP | SSH `systemctl restart` or `service restart` |
| SFTP + tomcat_remote_path | SSH `shutdown.sh; sleep 4; startup.sh` |
| SFTP + tomcat_run_as_user | SSH wrapped in `sudo su - <user> -c '...'` with PTY allocation |

For SSH `sudo su -`, a PTY is allocated (`pty: { rows: 24, cols: 80, term: 'vt100' }`) to satisfy TTY requirements. Exit code detection falls back to output keyword matching when PTY is involved.

---

## Server Reachability

On every app selection or Refresh, the app checks whether the server is reachable by attempting a **TCP connection** to the service port:
- SMB/RDP: port 445
- SFTP: configured SSH port (default 22)

Timeout is 2 seconds. Ping (ICMP) is deliberately not used — it is commonly blocked by corporate firewalls even when the service port is open.

If unreachable:
- An **offline banner** is shown above the toolbar
- All server-side action buttons are disabled (Detect Status, Deploy WAR, Restart Tomcat, Fetch Emails, Deploy, Preview Merge)

On Refresh, the check runs fresh — buttons remain disabled if the server is still down, and re-enable only if the check succeeds.

---

## Auto-Detect Status

When the inbox loads, all staged patches are checked against the deployed app directory by comparing file modification times:
- App file exists and `mtime >= patch file mtime` → auto-marked `deployed`
- App file missing or patch is newer → remains `pending`
- GIAS patches: all files in the extracted archive are checked

If all files in a patch are auto-detected as deployed, the patch status is set to `deployed` automatically without user action.

The check runs with a 5-second timeout (renderer-side `Promise.race`). If the server share is unreachable and the check hangs, the timeout fires and the offline banner is shown.

---

## Deployment Log

Every deploy, merge, extraction, and Tomcat restart action is written to the `deployment_log` table in SQLite. The **Deploy Log** view:
- Shows a filterable table of all log entries (app, action, status, detail, timestamp)
- Supports export to CSV
- Actions logged: `deploy`, `deploy-gias`, `merge`, `extract`, `tomcat-restart`, `mark-manual`, `save_attachment`, `inspect_archive`

---

## Auto-Update

The app checks for updates on GitHub Releases on startup (5-second delay) and when manually triggered. Update flow:
- If an update is available, an **Update Banner** appears with release version info
- User chooses to download (differential download — only changed blocks, not the full installer)
- After download, user installs on next quit

`differentialPackage: true` is configured in electron-builder for delta updates. Updates are published to the `Alizaidi128/patch_manager` GitHub repo.

---

## System Tray

The app minimizes to the system tray instead of closing. From the tray:
- Click icon to restore the window
- Right-click → **Show** or **Quit**

---

## Settings

Global settings (stored in SQLite `settings` table):

| Key | Description |
|---|---|
| `patches_root_dir` | Default local folder where patch subfolders are created (default: `D:\Office\Patches_automated`) |
| `outlook_poll_on_startup` | Whether to auto-fetch emails on app launch |

---

## Logging

All activity is written to a rotating log file at `<app_dir>/logs/app.log` (rotates at 10 MB). Timestamps are in PKT (Pakistan Standard Time, UTC+5).

Log levels:
- `INFO` — normal operations, IPC calls, fetch results, deploy results
- `WARN` — non-fatal issues (reachability failures, PS fallback, low-confidence paths)
- `ERROR` — failures that surface to the user
- `DEBUG` — verbose details (no-host reachability skip)
- `QUERY` — every SQL write operation (file only, not console)

Key log markers:
- `[IPC <channel>]` — every IPC call with duration and success/fail
- `[fetch:<app>]` — per-email processing, attachment classification, path detection
- `[outlook]` — PowerShell execution, email count returned
- `[reachability]` — TCP check result per app
- `[auto-detect]` — mtime comparison results
- `[merge:preview]` — file, resolved path, hasChanges
- `[mark-deployed]` — manual mark actions
- `[set-path]` — path edits
- `[war:deploy]` / `[tomcat:restart]` — WAR upload and restart results
- `[updater]` — update check and download events
- `[DB]` — database open path

---

## Database

SQLite database stored in Electron's `userData` directory (`patch-manager.db`). Tables:

| Table | Description |
|---|---|
| `apps` | Application configurations |
| `patches` | One record per email processed |
| `patch_files` | One record per file in a patch |
| `deployment_log` | Audit log of all deploy/merge/restart actions |
| `settings` | Global key-value configuration |

Schema migrations run at startup (safe `ALTER TABLE ... ADD COLUMN` wrapped in try/catch for idempotency).

---

## Tech Stack

| Component | Technology |
|---|---|
| Shell | Electron 29 |
| UI | React 18 + Vite |
| Database | better-sqlite3 (SQLite) |
| SSH/SFTP | ssh2 + ssh2-sftp-client |
| ZIP/RAR extraction | adm-zip + node-unrar-js |
| XML parsing | fast-xml-parser |
| Updates | electron-updater |
| Outlook | PowerShell COM automation |
| Build | electron-builder (NSIS installer, x64) |
