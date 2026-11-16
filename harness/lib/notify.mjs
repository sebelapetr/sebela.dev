// Windows notifications from WSL, for what the owner should see without watching the console. It
// uses the toast API that ships with Windows, through powershell.exe; elsewhere it does nothing.
// It never throws: a notification that cannot be shown must not stop the loop.

import { execFileSync } from "node:child_process";

// PowerShell's own app id: its toasts are shown without registering an app.
const APP_ID = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";

// Escaping every quote also means no line can start with '@, which would end the here-string.
const xml = (text) =>
  String(text)
    .replace(/\s+/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export function toastScript({ title, lines }) {
  const texts = [title, ...lines].map((line) => `<text>${xml(line)}</text>`).join("");
  return [
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null",
    "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null",
    // A literal here-string: nothing in it is expanded.
    "$xml = @'",
    `<toast scenario="reminder"><visual><binding template="ToastGeneric">${texts}</binding></visual><actions><action content="OK" arguments="dismiss" activationType="system"/></actions></toast>`,
    "'@",
    "$doc = New-Object Windows.Data.Xml.Dom.XmlDocument",
    "$doc.LoadXml($xml)",
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${APP_ID}').Show([Windows.UI.Notifications.ToastNotification]::new($doc))`,
  ].join("\n");
}

export const encodeCommand = (script) => Buffer.from(script, "utf16le").toString("base64");

const run = (command, args) => execFileSync(command, args, { stdio: "ignore", timeout: 30_000 });

// Returns whether the notification was handed to Windows.
export function notify({ title, lines = [] }, { exec = run } = {}) {
  try {
    exec("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      encodeCommand(toastScript({ title, lines })),
    ]);
    return true;
  } catch {
    return false;
  }
}

// The steward checks every 15 minutes; a problem is worth a notification when it is new.
export const newProblem = (previousStatus, status) =>
  status === "problem" && previousStatus !== "problem";
