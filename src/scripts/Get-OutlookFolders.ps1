try {
  $outlook = [Runtime.InteropServices.Marshal]::GetActiveObject("Outlook.Application")
} catch {
  Write-Error "OUTLOOK_NOT_RUNNING"
  exit 1
}

$namespace = $outlook.GetNamespace("MAPI")

function Get-FolderTree($folder, $parentPath) {
  $result = @()
  $currentPath = if ($parentPath -eq "") { $folder.Name } else { "$parentPath/$($folder.Name)" }
  $depth = ($currentPath -split "/").Count - 1

  $result += @{
    name  = $folder.Name
    path  = $currentPath
    count = $folder.Items.Count
    depth = $depth
  }

  foreach ($sub in $folder.Folders) {
    $result += Get-FolderTree $sub $currentPath
  }
  return $result
}

$allFolders = @()
$stores = $namespace.Folders
for ($i = 1; $i -le $stores.Count; $i++) {
  $store = $stores.Item($i)
  $allFolders += Get-FolderTree $store ""
}

$allFolders | ConvertTo-Json -Depth 10
