param([string]$ServiceName)
try {
    Restart-Service -Name $ServiceName -Force -ErrorAction Stop
    Write-Output "SUCCESS"
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
