@echo off
chcp 65001 >nul
cd /d "%~dp0"

where python >nul 2>nul
if %errorlevel%==0 (
  echo 启动本地服务器 http://localhost:8080/ ...
  powershell -NoProfile -Command "Start-Process python -ArgumentList '-m','http.server','8080' -WorkingDirectory (Get-Location) -WindowStyle Hidden; Start-Sleep -Seconds 1; Start-Process 'http://localhost:8080/'"
  goto :done
)

where node >nul 2>nul
if %errorlevel%==0 (
  echo 启动本地服务器 http://localhost:8080/ ...
  powershell -NoProfile -Command "$code = 'const http=require(\"http\"),fs=require(\"fs\"),path=require(\"path\");const mime={\".html\":\"text/html\",\".js\":\"text/javascript\",\".css\":\"text/css\",\".glb\":\"model/gltf-binary\",\".png\":\"image/png\",\".jpg\":\"image/jpeg\",\".jpeg\":\"image/jpeg\",\".json\":\"application/json\"};http.createServer((q,s)=>{let p=decodeURIComponent(q.url.split(\"?\")[0]);if(p===\"/\")p=\"/index.html\";fs.readFile(path.join(process.cwd(),p),(e,d)=>{if(e){s.writeHead(404);s.end(\"404\");return;}s.writeHead(200,{\"Content-Type\":mime[path.extname(p)]||\"application/octet-stream\"});s.end(d);});}).listen(8080);'; Start-Process node -ArgumentList '-e', $code -WorkingDirectory (Get-Location) -WindowStyle Hidden; Start-Sleep -Seconds 1; Start-Process 'http://localhost:8080/'"
  goto :done
)

echo 未找到 Python 或 Node.js，请先安装其一，再运行本脚本。
pause

:done
echo.
echo 如需停止服务器：任务管理器结束 python/node 进程即可。
timeout /t 3 >nul
