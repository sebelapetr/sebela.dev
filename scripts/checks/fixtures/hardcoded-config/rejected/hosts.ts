// Deliberately hard-coded local host addresses of a fictional client.
export const apiUrl = "http://localhost/api";
export const bindAddress = "0.0.0.0";
export const loopback = "127.0.0.1";
export const ipv6Loopback = "[::1]";
export const fromEnvironment = process.env["API_URL"] || "https://api.example.invalid";
