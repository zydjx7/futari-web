@echo off
setlocal EnableExtensions
set "toolchain=stable-x86_64-pc-windows-msvc"

where.exe rustup.exe >nul 2>&1
if not errorlevel 1 (
  set "rustup=rustup.exe"
  goto verify
)
if not defined CARGO_HOME set "CARGO_HOME=F:\Rust\cargo"
if not defined RUSTUP_HOME set "RUSTUP_HOME=F:\Rust\rustup"
set "rustup=%CARGO_HOME%\bin\rustup.exe"
setx.exe CARGO_HOME "%CARGO_HOME%" >nul || exit /b 1
setx.exe RUSTUP_HOME "%RUSTUP_HOME%" >nul || exit /b 1
if exist "%rustup%" goto verify

winget.exe install --id Rustlang.Rustup --exact --source winget --override "-y --profile minimal --default-host x86_64-pc-windows-msvc --default-toolchain stable"
if errorlevel 1 exit /b 1

:verify
"%rustup%" run %toolchain% rustc --version >nul 2>&1
if errorlevel 1 (
  "%rustup%" toolchain install %toolchain% --profile minimal || exit /b 1
)
"%rustup%" run %toolchain% rustc -vV || exit /b 1
"%rustup%" run %toolchain% cargo --version
exit /b %errorlevel%
