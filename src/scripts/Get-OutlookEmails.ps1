param(
  [string]$FolderPath,   # Full path: "StoreName/Folder/Subfolder/..."
  [string]$SinceDate,
  [string]$ToDate = "",
  [int]$MaxEmails = 100
)

# PS 5.1 stdout defaults to the system OEM code page (often Windows-1252).
# Node.js reads child-process stdout as UTF-8, so any non-ASCII char in email
# bodies would be emitted as Windows-1252 bytes and cause JSON.parse to fail.
# This line forces UTF-8 on both the PS internal pipeline and the console stream.
$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Check Outlook process first (works regardless of COM bitness)
$outlookProc = Get-Process outlook -ErrorAction SilentlyContinue
if (-not $outlookProc) {
  Write-Error "OUTLOOK_NOT_RUNNING"
  exit 1
}

# Attach to the running Outlook instance via COM
try {
  $outlook = [Runtime.InteropServices.Marshal]::GetActiveObject("Outlook.Application")
} catch {
  # GetActiveObject fails on bitness mismatch (32-bit Outlook + 64-bit PS) — fall back to New-Object
  try {
    $outlook = New-Object -ComObject Outlook.Application
  } catch {
    Write-Error "OUTLOOK_NOT_RUNNING"
    exit 1
  }
}

$namespace = $outlook.GetNamespace("MAPI")

# First segment is the store/PST display name; rest are subfolder segments
$parts    = $FolderPath -split "/"
$storeName = $parts[0].Trim()
$subParts  = if ($parts.Count -gt 1) { $parts[1..($parts.Count - 1)] } else { @() }

# Locate the correct MAPI store by display name
$store = $null
for ($i = 1; $i -le $namespace.Folders.Count; $i++) {
  $s = $namespace.Folders.Item($i)
  if ($s.Name -eq $storeName) { $store = $s; break }
}
if ($null -eq $store) {
  Write-Error "STORE_NOT_FOUND: $storeName"
  exit 1
}

# Navigate subfolder path
$folder = $store
foreach ($part in $subParts) {
  $trimmed = $part.Trim()
  if ($trimmed -eq "") { continue }
  $folder = $folder.Folders[$trimmed]
  if ($null -eq $folder) {
    Write-Error "FOLDER_NOT_FOUND: $trimmed"
    exit 1
  }
}

$since  = [DateTime]::Parse($SinceDate)
$toEnd  = if ($ToDate -ne "") { [DateTime]::Parse($ToDate).AddDays(1) } else { [DateTime]::MaxValue }
$results = @()

# Use Items.Restrict with a DASL date filter — much faster than iterating all items.
# Falls back to a full scan if Restrict isn't supported (e.g. some PST stores).
$mailItems = $null
try {
  $sinceUtc = $since.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  $filter   = "@SQL=""urn:schemas:httpmail:datereceived"" >= '$sinceUtc'"
  $mailItems = $folder.Items.Restrict($filter)
} catch {
  $mailItems = $folder.Items
}

foreach ($mail in $mailItems) {
  if ($mail.Class -ne 43) { continue }
  if ($mail.ReceivedTime -lt $since) { continue }
  if ($mail.ReceivedTime -ge $toEnd) { continue }

  $attachments = @()
  foreach ($att in $mail.Attachments) {
    $attachments += @{
      filename = $att.FileName
      size     = $att.Size
      index    = $att.Index
    }
  }

  # Extract plain-text body, sanitized for safe JSON serialization
  $bodyText = ""
  try {
    $raw = $mail.Body
    if (-not $raw -or $raw.Trim() -eq "") {
      $raw = $mail.HTMLBody -replace '<[^>]+>', ' '
    }
    if ($raw) {
      # Remove C0/C1 control characters and null bytes
      $raw = $raw -replace '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', ''
      # Strip Unicode line/paragraph separators (U+2028/U+2029) - PS 5.1 ConvertTo-Json chokes on these
      $raw = $raw -replace [char]0x2028, ' '
      $raw = $raw -replace [char]0x2029, ' '
      # Collapse excessive horizontal whitespace; preserve newlines so quote-strip patterns work
      $raw = $raw -replace '[^\S\r\n]{2,}', ' '
      $raw = $raw -replace '(\r?\n){4,}', "`n`n`n"
      if ($raw.Length -gt 4000) { $raw = $raw.Substring(0, 4000) }
      $bodyText = $raw.Trim()
    }
  } catch { $bodyText = "" }

  # Sanitize subject — same separators can appear in subjects
  $safeSubject = ""
  try {
    $safeSubject = ($mail.Subject -replace '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '') `
                                 -replace [char]0x2028, ' ' `
                                 -replace [char]0x2029, ' '
  } catch { $safeSubject = "" }

  $results += @{
    entryId        = $mail.EntryID
    subject        = $safeSubject
    sender         = $mail.SenderEmailAddress
    senderName     = $mail.SenderName
    receivedTime   = $mail.ReceivedTime.ToString("yyyy-MM-ddTHH:mm:ss")
    hasAttachments = ($mail.Attachments.Count -gt 0)
    attachments    = $attachments
    folder         = $FolderPath
    body           = $bodyText
  }

  if ($results.Count -ge $MaxEmails) { break }
}

# Serialize each item individually so one bad email can't corrupt the whole output.
# PS 5.1 ConvertTo-Json can fail mid-stream on unusual Unicode; per-item catch isolates it.
$jsonParts = @()
foreach ($item in $results) {
  try {
    $jsonParts += ($item | ConvertTo-Json -Depth 5 -Compress)
  } catch {
    Write-Error "ITEM_SERIALIZE_ERROR: subject=$($item.subject) - $_"
  }
}
Write-Output ("[" + ($jsonParts -join ",") + "]")
