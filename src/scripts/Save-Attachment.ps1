param(
  [string]$EntryId,
  [int]$AttachmentIndex,
  [string]$SavePath
)

try {
  $outlook = [Runtime.InteropServices.Marshal]::GetActiveObject("Outlook.Application")
} catch {
  Write-Error "OUTLOOK_NOT_RUNNING"
  exit 1
}

$namespace  = $outlook.GetNamespace("MAPI")
$mail       = $namespace.GetItemFromID($EntryId)
$attachment = $mail.Attachments.Item($AttachmentIndex)
$attachment.SaveAsFile($SavePath)
Write-Output "SAVED"
