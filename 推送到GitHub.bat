@echo off
chcp 65001 >nul
title 推送诗册到 GitHub（Molelung/PoemCard 仓库的 book 分支）
echo ========================================================
echo        诗册 · 悬浮古籍（三维翻页 + 诗笺网站）
echo        GitHub 一键推送
echo ========================================================
echo.
echo  说明：
echo   · 推送到 Molelung/PoemCard 仓库的 book 分支
echo   · 不会动你原来的 main 分支（PoemCard 旧版内容与历史都还在）
echo   · 需要一次 GitHub 令牌（Personal Access Token）
echo.

set REPO=https://github.com/Molelung/PoemCard.git

echo  令牌请到 https://github.com/settings/tokens 生成：
echo    Generate new token (classic) -> 勾选 repo -> 生成后复制
echo.
set /p TOKEN=请粘贴令牌（输入时屏幕不显示，粘贴后回车）:
if "%TOKEN%"=="" (
    echo 未输入令牌，退出。
    pause
    exit /b
)

echo.
echo 正在推送到 book 分支...
git -c http.sslBackend=openssl push "https://Molelung:%TOKEN%@github.com/Molelung/PoemCard.git" main:book

if errorlevel 1 (
    echo.
    echo 推送失败。常见原因：
    echo   · 令牌没勾 repo 权限，或已过期
    echo   · 网络需要代理（可先开着 Clash 再试）
    echo.
    pause
    exit /b
)

echo.
echo 推送成功。
echo.
echo 还需要在网页上点两下（只需一次）：
echo   1. 打开 https://github.com/Molelung/PoemCard/settings/pages
echo   2. Source 选 "Deploy from a branch"，Branch 选 book、目录选 / (root)，Save
echo   3. 等一分钟，访问 https://molelung.github.io/PoemCard/
echo.
pause
