const fs   = require('fs')
const path = require('path')
const os   = require('os')

function sftpOpts(app) {
  const opts = { host: app.server_host, port: app.server_port || 22, username: app.server_user, readyTimeout: 30000, retries: 0 }
  if (app.server_key_path) opts.privateKey = fs.readFileSync(app.server_key_path)
  else opts.password = app.server_password
  if (app.sftp_server_path) opts.sftpServerPath = app.sftp_server_path
  return opts
}

function sshOpts(app) {
  const opts = { host: app.server_host, port: app.server_port || 22, username: app.server_user, readyTimeout: 30000 }
  if (app.server_key_path) opts.privateKey = fs.readFileSync(app.server_key_path)
  else opts.password = app.server_password
  return opts
}

// Build a .war (ZIP) from localSrcPath contents in a worker thread (non-blocking).
// Saves the WAR inside localSrcPath's parent alongside the app folder.
function buildWar(localSrcPath, warName) {
  const { Worker } = require('worker_threads')
  const outPath = path.join(localSrcPath, `${warName}.war`)
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, 'buildWarWorker.js')
    const worker = new Worker(workerPath, { workerData: { src: localSrcPath, out: outPath } })
    worker.on('message', () => resolve(outPath))
    worker.on('error', reject)
    worker.on('exit', code => { if (code !== 0) reject(new Error(`WAR build worker exited with code ${code}`)) })
  })
}

// Upload WAR to remote server via SFTP:
//   1. Rename existing CONVUAT.war → CONVUAT bk dd-Mon-yy.war  (date = last deployed patch)
//   2. Upload new .war
async function deployWarSFTP(app, localWarPath, onProgress, lastPatchDate) {
  const SftpClient = require('ssh2-sftp-client')
  const sftp       = new SftpClient()
  const warName    = app.war_name
  const remoteDir  = (app.app_root_path || '').replace(/\/$/, '')
  const remoteWar  = `${remoteDir}/${warName}.war`

  const dateBase = lastPatchDate ? new Date(lastPatchDate) : new Date()
  const dateTag  = dateBase.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: '2-digit'
  }).replace(/ /g, '-')                           // e.g. "21-Aug-26"
  const backupWar = `${remoteDir}/${warName} bk ${dateTag}.war`

  const emit = (step, pct) => onProgress?.({ step, pct })
  try {
    await sftp.connect(sftpOpts(app))
    emit('Connected to server')

    try {
      await sftp.rename(remoteWar, backupWar)
      emit(`Backed up existing WAR → ${warName} bk ${dateTag}.war`)
    } catch {
      emit('No existing WAR to back up (first deploy)')
    }

    emit(`Uploading ${path.basename(localWarPath)}…`, 0)
    let lastPct = -1
    await sftp.fastPut(localWarPath, remoteWar, {
      step: (transferred, chunk, total) => {
        const pct = Math.round((transferred / total) * 100)
        if (pct !== lastPct && (pct % 5 === 0 || pct === 100)) {
          lastPct = pct
          emit(`Uploading… ${pct}%`, pct)
        }
      }
    })
    emit('Upload complete', 100)
    await sftp.end()
  } catch (e) {
    try { await sftp.end() } catch {}
    throw e
  }
}

// Restart Tomcat over SSH
async function restartTomcatSSH(app) {
  const { Client } = require('ssh2')

  let cmd
  if (app.tomcat_remote_path) {
    const t = app.tomcat_remote_path.replace(/\/$/, '')
    cmd = `${t}/bin/shutdown.sh 2>&1; sleep 4; ${t}/bin/startup.sh 2>&1`
  } else if (app.tomcat_service_name) {
    const name = app.tomcat_service_name
    cmd = `sudo systemctl restart ${name} 2>&1 || sudo service ${name} restart 2>&1`
  } else {
    throw new Error('No Tomcat path or service name configured')
  }

  return new Promise((resolve, reject) => {
    const conn = new Client()
    let out = ''
    conn.on('ready', () => {
      conn.exec(cmd, (err, stream) => {
        if (err) { conn.end(); return reject(err) }
        stream.on('data', d => { out += d.toString() })
        stream.stderr.on('data', d => { out += d.toString() })
        stream.on('close', () => { conn.end(); resolve(out.trim()) })
      })
    })
    conn.on('error', reject)
    conn.connect(sshOpts(app))
  })
}

// Restart Tomcat on the local Windows machine via net stop / net start
function restartTomcatLocal(app) {
  const { exec } = require('child_process')
  const name = app.tomcat_service_name
  if (!name) throw new Error('No Tomcat service name configured')
  const cmd = `net stop "${name}" && net start "${name}"`
  return new Promise((resolve, reject) => {
    exec(cmd, { shell: true }, (err, stdout, stderr) => {
      const out = [stdout, stderr].filter(Boolean).join('\n').trim()
      if (err) return reject(new Error(out || err.message))
      resolve(out)
    })
  })
}

// Run a command asynchronously — never blocks the Electron main-process event loop.
function runAsync(cmd, args, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process')
    const child = spawn(cmd, args, { stdio: 'pipe', windowsHide: true })
    let stdout = '', stderr = ''
    child.stdout?.on('data', d => { stdout += d })
    child.stderr?.on('data', d => { stderr += d })
    const timer = setTimeout(() => { try { child.kill() } catch {} resolve({ code: -1, stdout, stderr: 'timeout' }) }, timeoutMs)
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }) })
    child.on('error', err => { clearTimeout(timer); reject(err) })
  })
}

// Restart Tomcat on a remote Windows machine via WMI (DCOM port 135).
// Requires on the server: LocalAccountTokenFilterPolicy=1 and WMI firewall rules enabled.
async function restartTomcatRDP(app) {
  const name = app.tomcat_service_name
  if (!name) throw new Error('No Tomcat service name configured')
  const host = app.server_host
  if (!host) throw new Error('No server host configured')

  if (!app.server_user || !app.server_password) {
    throw new Error('Server username and password are required for RDP-Assisted Tomcat restart')
  }

  const safePwd  = app.server_password.replace(/'/g, "''")
  const safeName = name.replace(/'/g, "''")

  // Poll for Stopped state before starting — avoids racing on STOP_PENDING
  const wmiScript = [
    `$pass = ConvertTo-SecureString '${safePwd}' -AsPlainText -Force`,
    `$cred = New-Object PSCredential('${app.server_user}', $pass)`,
    `$svc = Get-WmiObject -ComputerName '${host}' -Class Win32_Service -Filter "Name='${safeName}'" -Credential $cred -ErrorAction Stop`,
    `if (-not $svc) { throw "Service '${safeName}' not found on ${host}" }`,
    `Write-Output "Stopping $($svc.Name) (current state: $($svc.State))"`,
    `if ($svc.State -ne 'Stopped') { ($svc.StopService()) | Out-Null }`,
    // Wait up to 15 s for graceful stop
    `$i = 0; do { Start-Sleep -Seconds 3; $svc.Get(); $i++ } while ($svc.State -ne 'Stopped' -and $i -lt 5)`,
    // If still not stopped, kill ALL Tomcat* and child java processes via WMI (handles procrun wrapper + JVM)
    `if ($svc.State -ne 'Stopped') {`,
    `  Write-Output "Graceful stop timed out — killing process tree"`,
    `  $allProcs = Get-WmiObject -ComputerName '${host}' -Class Win32_Process -Credential $cred`,
    `  $svc.Get(); $svcPid = $svc.ProcessId`,
    // Kill the service process and any child processes
    `  $childPids = $allProcs | Where-Object { $_.ParentProcessId -eq $svcPid } | ForEach-Object { $_.ProcessId }`,
    `  $childPids | ForEach-Object { $allProcs | Where-Object { $_.ProcessId -eq $_ } | ForEach-Object { $_.Terminate() | Out-Null } }`,
    `  $allProcs | Where-Object { $_.ProcessId -eq $svcPid } | ForEach-Object { $_.Terminate() | Out-Null }`,
    // Also kill any remaining Tomcat*/java processes associated with this service by name
    `  Get-WmiObject -ComputerName '${host}' -Class Win32_Process -Credential $cred -Filter "Name LIKE 'Tomcat%' OR Name='java.exe'" | ForEach-Object { $_.Terminate() | Out-Null }`,
    `  Write-Output "Process tree killed — waiting for SCM to update"`,
    `  $j = 0; do { Start-Sleep -Seconds 2; $svc.Get(); $j++ } while ($svc.State -ne 'Stopped' -and $j -lt 10)`,
    `}`,
    `if ($svc.State -ne 'Stopped') { throw "Service did not stop (state: $($svc.State))" }`,
    `Write-Output "Service stopped. Starting..."`,
    `$r = $svc.StartService()`,
    `if ($r.ReturnValue -ne 0) { throw "StartService failed (WMI code $($r.ReturnValue))" }`,
    `Write-Output "Tomcat restarted successfully"`
  ].join('; ')

  const result = await runAsync(
    'powershell', ['-NonInteractive', '-NoProfile', '-Command', wmiScript], 180000
  )
  if (result.code === 0) return result.stdout || 'Tomcat restarted'

  const detail = [result.stdout, result.stderr].filter(Boolean).join('\n')
  throw new Error(detail || 'WMI restart failed')
}

module.exports = { buildWar, deployWarSFTP, restartTomcatSSH, restartTomcatLocal, restartTomcatRDP }
