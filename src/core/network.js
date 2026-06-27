import os from "node:os";

export function getLanIp(preferFamily = "IPv4") {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.internal) continue;
      if (iface.family !== preferFamily) continue;
      if (iface.address) return iface.address;
    }
  }

  if (preferFamily === "IPv4") {
    const ipv6 = getLanIp("IPv6");
    if (ipv6) return ipv6;
  }

  return "127.0.0.1";
}
