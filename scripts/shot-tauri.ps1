Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$ErrorActionPreference = "Stop"
$exe = "C:\Users\17694\WorkBuddy AI\spaces\2026_11_18_21-42-52\src-tauri\target\release\ferry-launcher.exe"
$out = "C:\Users\17694\WorkBuddy AI\spaces\2026_11_18_21-42-52\shots\tauri-1.png"
New-Item -ItemType Directory -Force -Path (Split-Path $out) | Out-Null
Get-Process ferry-launcher -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 400
$proc = Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds 7
if ($proc.HasExited) {
  Write-Output "PROCESS_EXITED code=$($proc.ExitCode)"
  exit 1
}
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "OK alive=$(-not $proc.HasExited) size=$($bounds.Width)x$($bounds.Height)"
