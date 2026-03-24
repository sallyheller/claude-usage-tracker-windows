#!/usr/bin/env node
/**
 * tray-launcher.js — Comando `claude-usage-tray`
 * Lanza la bandeja del sistema completamente desacoplada del terminal.
 * Usa wscript.exe + VBScript para evitar que el proceso muera al cerrar la terminal.
 */

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { spawn } = require('child_process');

if (process.platform !== 'win32') {
  console.error('Claude Usage Tracker solo está disponible en Windows.');
  process.exit(1);
}

const trayScript = path.join(__dirname, 'tray.ps1');

// Escribe un VBScript temporal que lanza PowerShell sin consola ni terminal padre
const vbsContent = `Dim sh : Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & "${trayScript.replace(/\\/g,'\\\\')}" & """", 0, False
`;

const vbsPath = path.join(os.tmpdir(), 'claude-usage-tray-launch.vbs');
fs.writeFileSync(vbsPath, vbsContent, 'ascii');

const proc = spawn('wscript.exe', [vbsPath], { detached: true, stdio: 'ignore' });
proc.unref();

console.log('Bandeja del sistema iniciada. Busca el icono $ en la esquina inferior derecha.');
