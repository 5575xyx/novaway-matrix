@echo off
cd /d E:\AImoney\NovaWay-Matrix\novaway-coder
git push -u origin master --no-verify > push-gitee.log 2>&1
echo EXIT:%ERRORLEVEL%>> push-gitee.log