param(
  [string]$FolderPath,   # Full path: "StoreName/Folder/Subfolder/..."
  [string]$SinceDate,
  [int]$MaxEmails = 100
)

try {
  $outlook = [Runtime.InteropServices.Marshal]::GetActiveObject("Outlook.Application")
} catch {
  Write-Error "OUTLOOK_NOT_RUNNING"
  exit 1
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

$since   = [DateTime]::Parse($SinceDate)
$results = @()

foreach ($mail in $folder.Items) {
  if ($mail.Class -ne 43) { continue }   # 43 = olMail
  if ($mail.ReceivedTime -lt $since) { continue }

  $attachments = @()
  foreach ($att in $mail.Attachments) {
    $attachments += @{
      filename = $att.FileName
      size     = $att.Size
      index    = $att.Index
    }
  }

  $results += @{
    entryId        = $mail.EntryID
    subject        = $mail.Subject
    sender         = $mail.SenderEmailAddress
    senderName     = $mail.SenderName
    receivedTime   = $mail.ReceivedTime.ToString("yyyy-MM-ddTHH:mm:ss")
    body           = $mail.Body
    htmlBody       = $mail.HTMLBody
    hasAttachments = ($mail.Attachments.Count -gt 0)
    attachments    = $attachments
    folder         = $FolderPath
  }

  if ($results.Count -ge $MaxEmails) { break }
}

$results | ConvertTo-Json -Depth 5
