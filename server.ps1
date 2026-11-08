# سَكَن | خادم محلي لتجربة الموقع على الكمبيوتر
$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path))
$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.svg' = 'image/svg+xml'
  '.json' = 'application/json'; '.ico' = 'image/x-icon'; '.webp' = 'image/webp'
}

$listener = $null
foreach ($p in 8080..8090) {
  try {
    $l = New-Object System.Net.HttpListener
    $l.Prefixes.Add("http://localhost:$p/")
    $l.Start()
    $listener = $l; $port = $p; break
  } catch { }
}
if (-not $listener) { Write-Host 'تعذّر تشغيل الخادم: المنافذ 8080-8090 مشغولة.'; Read-Host 'اضغط Enter للإغلاق'; exit 1 }

$url = "http://localhost:$port/index.html"
Write-Host ''
Write-Host "الموقع يعمل الآن على: $url"
Write-Host 'اترك هذه النافذة مفتوحة أثناء الاستخدام. أغلقها لإيقاف الموقع.'
Start-Process $url

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $rel = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq '') { $rel = 'index.html' }
    $full = [System.IO.Path]::GetFullPath((Join-Path $root $rel))
    if ($full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $full -PathType Leaf)) {
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      $ctx.Response.ContentType = $(if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' })
      $ctx.Response.Headers.Add('Cache-Control', 'no-store')
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
    }
  } catch {
    $ctx.Response.StatusCode = 500
  } finally {
    $ctx.Response.Close()
  }
}
