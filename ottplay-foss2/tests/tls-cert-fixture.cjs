"use strict";
// Ephemeral synthetic certificates only; no private keys are committed.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
function certificates(directory, weak) {
    const file = name => path.join(directory, name);
    const openssl = (...args) => execFileSync("openssl", args, { stdio: "pipe", timeout: 15000 });
    function key(name, bits) {
        openssl("genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:" + bits, "-out", file(name + ".key"));
    }
    key("root", weak === "root" ? 1024 : 2048);
    fs.writeFileSync(file("root.cnf"), "[req]\ndistinguished_name=dn\nx509_extensions=ca\nprompt=no\n[dn]\nCN=Synthetic TLS test root\n[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n");
    openssl("req", "-new", "-x509", "-sha256", "-days", "1", "-key", file("root.key"), "-out", file("root.pem"), "-config", file("root.cnf"));
    let signer = "root", intermediate = "";
    function sign(name, extensions, serial) {
        fs.writeFileSync(file(name + ".ext"), extensions);
        openssl("req", "-new", "-key", file(name + ".key"), "-out", file(name + ".csr"), "-subj", "/CN=Synthetic TLS test " + name);
        openssl("x509", "-req", "-sha256", "-days", "1", "-in", file(name + ".csr"), "-CA", file(signer + ".pem"), "-CAkey", file(signer + ".key"), "-set_serial", serial, "-extfile", file(name + ".ext"), "-out", file(name + ".pem"));
    }
    if (weak === "intermediate") {
        key("intermediate", 1024);
        sign("intermediate", "basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n", "2");
        signer = "intermediate"; intermediate = fs.readFileSync(file("intermediate.pem"), "utf8");
    }
    key("leaf", weak === "leaf" ? 1024 : 2048);
    sign("leaf", "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1\n", "3");
    fs.writeFileSync(file("chain.pem"), fs.readFileSync(file("leaf.pem"), "utf8") + intermediate);
    return file("root.pem");
}
module.exports = { certificates };
