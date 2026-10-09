// All values are synthetic. No production credentials belong in this file.
export const uuid = "11111111-1111-4111-8111-111111111111";
export const vless = `vless://${uuid}@example.com:443?encryption=none&security=reality&flow=xtls-rprx-vision&type=tcp&sni=example.com&fp=chrome&pbk=fake-public-key&sid=abcd&spx=%2Fsynthetic#日本%20测试`;
export const vmess =
  "vmess://" +
  Buffer.from(
    JSON.stringify({
      v: "2",
      ps: "虚构 VMess",
      add: "example.com",
      port: "443",
      id: uuid,
      aid: "0",
      scy: "auto",
      net: "tcp",
      type: "none",
      tls: "tls",
      sni: "example.com",
      insecure: "0",
    }),
  ).toString("base64");
export const nonRfcVmessUuid = "22222222-2222-4222-f222-222222222222";
export const nonRfcVmess =
  "vmess://" +
  Buffer.from(
    JSON.stringify(
      {
        v: "2",
        ps: "虚构非 RFC VMess",
        add: "example.com",
        port: "443",
        id: nonRfcVmessUuid,
        aid: "0",
        scy: "auto",
        net: "tcp",
        type: "none",
        host: "",
        path: "",
        tls: "tls",
        sni: "example.com",
        alpn: "",
        fp: "",
        insecure: "0",
      },
      null,
      2,
    ) + "\r\n",
  ).toString("base64");
export const fixtures = [
  ["Reality Vision", vless],
  [
    "TLS WS",
    `vless://${uuid}@example.com:443?security=tls&type=ws&path=%2Fsocket&host=cdn.example.com#WS`,
  ],
  [
    "gRPC",
    `vless://${uuid}@example.com:443?security=tls&type=grpc&serviceName=test#GRPC`,
  ],
  [
    "HTTPUpgrade",
    `vless://${uuid}@example.com:443?security=tls&type=httpupgrade&path=%2Fup&host=cdn.example.com#Upgrade`,
  ],
  [
    "XHTTP",
    `vless://${uuid}@example.com:443?security=tls&type=xhttp&path=%2Fx&host=cdn.example.com&mode=auto#XHTTP`,
  ],
  ["IPv6", `vless://${uuid}@[2001:db8::1]:443?security=tls&type=tcp#IPv6`],
  ["VMess", vmess],
  ["Trojan", "trojan://synthetic-pass@example.com:443?sni=example.com#Trojan"],
  [
    "SS",
    "ss://" +
      Buffer.from("aes-256-gcm:synthetic-password").toString("base64url") +
      "@example.com:8388#SS",
  ],
  [
    "HY2",
    "hysteria2://synthetic-password@example.com:443?sni=example.com&obfs=salamander&obfs-password=fake-obfs#HY2",
  ],
  [
    "TUIC",
    `tuic://${uuid}:synthetic-password@example.com:443?sni=example.com&congestion_control=bbr&udp_relay_mode=native#TUIC`,
  ],
] as const;
