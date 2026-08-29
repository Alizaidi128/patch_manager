param(
  [string]$EntryId,
  [int]$AttachmentIndex,
  [string]$SavePath
)

$outlookProc = Get-Process outlook -ErrorAction SilentlyContinue
if (-not $outlookProc) {
  Write-Error "OUTLOOK_NOT_RUNNING"
  exit 1
}

try {
  $outlook = [Runtime.InteropServices.Marshal]::GetActiveObject("Outlook.Application")
} catch {
  try {
    $outlook = New-Object -ComObject Outlook.Application
  } catch {
    Write-Error "OUTLOOK_NOT_RUNNING"
    exit 1
  }
}

$namespace  = $outlook.GetNamespace("MAPI")
$mail       = $namespace.GetItemFromID($EntryId)
$attachment = $mail.Attachments.Item($AttachmentIndex)
$attachment.SaveAsFile($SavePath)
Write-Output "SAVED"
