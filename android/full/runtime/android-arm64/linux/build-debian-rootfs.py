#!/usr/bin/env python3
"""Builds a Debian bookworm arm64 rootfs with chromium, without root:
pulls the official debian:bookworm arm64 layer from the Docker registry,
then apt-resolves chromium's dependency closure and unpacks every .deb."""
import hashlib
import json
import os
import subprocess
import tempfile
import urllib.parse
import urllib.request
import lzma
import gzip

# Pinned from the first CI rootfs (2026-10-28). The trixie tag resolved to this
# arm64 digest, and the nearest snapshot.debian.org timestamp before that run
# is 20261028T022757Z. Both are the only sources this script pulls.
BASE_DIGEST = "sha256:39f862f398f8ea1a2ffee9bbe02c649be6779244bd6a834c4f71155172f801f2"
SNAPSHOT = "20261028T022757Z"

WORK = os.path.expanduser("~/debianrootfs")
TOKEN_URL = "https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/debian:pull"
REGISTRY = "https://registry-1.docker.io/v2/library/debian"

os.makedirs(WORK, exist_ok=True)
os.chdir(WORK)

def archive_keyring():
    for candidate in (
        "/usr/share/keyrings/debian-archive-keyring.pgp",
        "/usr/share/keyrings/debian-archive-keyring.gpg",
    ):
        if os.path.isfile(candidate):
            return candidate
    raise SystemExit("debian-archive-keyring is not installed")


def verify_release(uri, suite):
    """gpgv the snapshot Release file, then return its SHA256 name map."""
    base = f"{uri}/dists/{suite}"
    release = fetch(f"{base}/Release")
    signature = fetch(f"{base}/Release.gpg")
    keyring = archive_keyring()
    with tempfile.TemporaryDirectory() as tmp:
        release_path = os.path.join(tmp, "Release")
        signature_path = os.path.join(tmp, "Release.gpg")
        with open(release_path, "wb") as handle:
            handle.write(release)
        with open(signature_path, "wb") as handle:
            handle.write(signature)
        checked = subprocess.run(
            ["gpgv", "--keyring", keyring, signature_path, release_path],
            capture_output=True, text=True,
        )
        if "BAD signature" in checked.stderr or "Good signature" not in checked.stderr:
            print(checked.stderr)
            raise SystemExit(f"Release signature failed for {suite}")
        # Debian signs Release with several archive keys. gpgv exits 2 when this
        # keyring can check one of them and does not contain the others.
        if checked.returncode not in (0, 2):
            print(checked.stderr)
            raise SystemExit(f"Release signature failed for {suite}")
        print(checked.stderr.strip())
    print(f"Release signature ok: {suite}")
    entries = {}
    in_sha = False
    for line in release.decode().splitlines():
        if line.startswith("SHA256:"):
            in_sha = True
            continue
        if not in_sha:
            continue
        if not line.startswith(" "):
            in_sha = False
            continue
        digest, _size, name = line.split()
        entries[name] = digest
    return entries


def packages_from_release(uri, suite, entries):
    """Verify Packages indexes against Release and return Filename -> SHA256."""
    records = {}
    wanted = tuple(
        suffix for suffix in (
            "main/binary-arm64/Packages.xz",
            "main/binary-all/Packages.xz",
            "main/binary-arm64/Packages.gz",
            "main/binary-all/Packages.gz",
        )
    )
    for name in wanted:
        digest = entries.get(name)
        if digest is None:
            continue
        blob = fetch(f"{uri}/dists/{suite}/{name}")
        got = hashlib.sha256(blob).hexdigest()
        if got != digest:
            raise SystemExit(f"Packages hash mismatch for {suite}/{name}")
        if name.endswith(".xz"):
            text = lzma.decompress(blob).decode()
        else:
            text = gzip.decompress(blob).decode()
        for block in text.split("\n\n"):
            fields = {}
            for line in block.splitlines():
                if not line or line.startswith(" ") or ":" not in line:
                    continue
                key, value = line.split(":", 1)
                fields[key] = value.strip()
            filename = fields.get("Filename")
            sha = fields.get("SHA256")
            if filename and sha:
                records[filename] = sha
    if not records:
        raise SystemExit(f"no Packages index verified for {suite}")
    print(f"Packages verified: {suite} ({len(records)} files)")
    return records


def fetch(url, accept=None, token=None):
    request = urllib.request.Request(url)
    if accept:
        request.add_header("Accept", accept)
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(request) as response:
        return response.read()

print("--- docker registry: debian:trixie arm64", BASE_DIGEST, "---")
print("snapshot:", SNAPSHOT)
token = json.loads(fetch(TOKEN_URL))["token"]
ACCEPT = ", ".join([
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
])
print("base image digest:", BASE_DIGEST)
with open(os.path.join(WORK, "base-image-digest.txt"), "w", encoding="utf-8") as digest_file:
    digest_file.write(BASE_DIGEST + "\n")
manifest = json.loads(fetch(f"{REGISTRY}/manifests/{BASE_DIGEST}", ACCEPT, token))
if not manifest.get("layers"):
    raise SystemExit("no layers")

rootfs = os.path.join(WORK, "rootfs")
subprocess.run(["rm", "-rf", rootfs], check=True)
os.makedirs(rootfs)
for number, layer in enumerate(manifest["layers"]):
    digest = layer["digest"]
    blob = os.path.join(WORK, f"layer-{number}.tar.gz")
    if not os.path.exists(blob):
        print("downloading layer", digest[:20], "size", layer["size"])
        request = urllib.request.Request(f"{REGISTRY}/blobs/{digest}")
        request.add_header("Authorization", f"Bearer {token}")
        with urllib.request.urlopen(request) as response, open(blob, "wb") as out:
            while True:
                chunk = response.read(1 << 20)
                if not chunk:
                    break
                out.write(chunk)
    subprocess.run(["tar", "-xzf", blob, "-C", rootfs], check=True)

print("rootfs base:", subprocess.run(["du", "-sh", rootfs], capture_output=True, text=True).stdout.strip())
status = os.path.join(rootfs, "var/lib/dpkg/status")
if not os.path.exists(status):
    raise SystemExit("layer had no dpkg status; not a debian root?")

lists = os.path.join(WORK, "apt-lists")
cache = os.path.join(WORK, "apt-cache-dir")
subprocess.run(["rm", "-rf", lists, cache], check=True)
os.makedirs(lists)
os.makedirs(cache)
sources = os.path.join(rootfs, "etc/apt/sources.list.d/debian.sources")
os.makedirs(os.path.dirname(sources), exist_ok=True)
# The image's own sources follow the moving deb.debian.org mirror. Replace them
# with the snapshot taken just before the first CI build.
with open(sources, "w", encoding="utf-8") as source_file:
    source_file.write(
        "Types: deb\n"
        f"URIs: https://snapshot.debian.org/archive/debian/{SNAPSHOT}\n"
        "Suites: trixie trixie-updates\n"
        "Components: main\n"
        f"Signed-By: {archive_keyring()}\n"
        "\n"
        "Types: deb\n"
        f"URIs: https://snapshot.debian.org/archive/debian-security/{SNAPSHOT}\n"
        "Suites: trixie-security\n"
        "Components: main\n"
        f"Signed-By: {archive_keyring()}\n"
    )
print("apt snapshot:", SNAPSHOT)

APT = ["apt-get",
       "-o", "APT::Architecture=arm64",
       "-o", "APT::Architectures::=arm64",
       "-o", f"Dir::State::status={status}",
       "-o", f"Dir::State::lists={lists}",
       "-o", f"Dir::Cache={cache}",
       "-o", "Debug::NoLocking=1",
       "-o", "Acquire::Check-Valid-Until=false",
       "-o", f"Dir::Etc::sourcelist={sources}",
       "-o", "Dir::Etc::sourceparts=-",
       "-o", f"Dir::Etc::trustedparts={os.path.join(rootfs, 'etc/apt/trusted.gpg.d')}",
       "-o", "APT::Install-Recommends=false",
       "-y"]

print("--- apt update (foreign root) ---")
subprocess.run(APT + ["update"], check=True)
PACKAGES = ["chromium", "python3", "git", "curl", "ca-certificates", "fonts-liberation", "fonts-dejavu-core", "fontconfig"]

def dedupe_hardlinks(root):
    """Android denies link(2) inside app storage, so a tarball with hard links
    (mesa's driver shims share inodes) cannot be extracted there: keep one real
    file per inode group and point the rest at it with relative symlinks."""
    seen = {}
    converted = 0
    for base, dirs, files in os.walk(root):
        for name in files:
            path = os.path.join(base, name)
            if os.path.islink(path):
                continue
            stat = os.lstat(path)
            if stat.st_nlink <= 1:
                continue
            key = (stat.st_dev, stat.st_ino)
            if key in seen and seen[key] != path:
                os.unlink(path)
                os.symlink(os.path.relpath(seen[key], base), path)
                converted += 1
            else:
                seen[key] = path
    print(f"hard links converted to symlinks: {converted}")

def add_compat_links(root):
    """The docker layer's /bin and /lib are plain directories while bookworm's
    binaries and the glibc loader live under /usr; the phone lane invokes
    /bin/bash directly and every binary's PT_INTERP names /lib/ld-linux…,
    so make sure those classic paths exist (relative symlinks only: they
    survive both toybox tar's safety check and Android's link(2) denial)."""
    added = 0
    for link, target in [("bin/bash", "usr/bin/bash"), ("bin/sh", "usr/bin/dash"),
                         ("bin/env", "usr/bin/env"), ("bin/ls", "usr/bin/ls"),
                         ("bin/cat", "usr/bin/cat"),
                         ("lib/ld-linux-aarch64.so.1", "usr/lib/ld-linux-aarch64.so.1")]:
        link_path = os.path.join(root, link)
        target_path = os.path.join(root, target)
        if os.path.exists(link_path) or os.path.islink(link_path) or not os.path.exists(target_path):
            continue
        os.symlink(os.path.relpath(target_path, os.path.dirname(link_path)), link_path)
        added += 1
    print(f"compat links added: {added}")

def build_ca_bundle(root):
    """dpkg-deb -x runs no maintainer scripts, so update-ca-certificates never
    assembles the bundle curl and friends expect; concatenate the shipped CAs
    the same way that hook does."""
    certs = os.path.join(root, "usr/share/ca-certificates/mozilla")
    bundle_dir = os.path.join(root, "etc/ssl/certs")
    if not os.path.isdir(certs):
        print("CA SOURCE MISSING")
        return
    os.makedirs(bundle_dir, exist_ok=True)
    names = sorted(name for name in os.listdir(certs) if name.endswith(".crt"))
    with open(os.path.join(bundle_dir, "ca-certificates.crt"), "wb") as bundle:
        for name in names:
            with open(os.path.join(certs, name), "rb") as cert:
                bundle.write(cert.read())
    print(f"ca-certificates.crt assembled from {len(names)} CAs")

def add_opencode_cli(root):
    """The opencode CLI (npm opencode-linux-arm64, glibc): the built-in OpenCode
    engine runs it inside the guest, through the phone lane's proot chain."""
    tgz = os.path.join(WORK, "opencode-linux-arm64.tgz")
    if not os.path.exists(tgz):
        subprocess.run(["curl", "-sL", "-o", tgz,
                        "https://registry.npmjs.org/opencode-linux-arm64/-/opencode-linux-arm64-1.19.4.tgz"],
                       check=True)
    pkg = os.path.join(WORK, "oc-pkg")
    subprocess.run(["rm", "-rf", pkg], check=True)
    os.makedirs(pkg)
    subprocess.run(["tar", "-xzf", tgz, "-C", pkg], check=True)
    binary = None
    for base, _, files in os.walk(pkg):
        if "opencode" in files:
            binary = os.path.join(base, "opencode")
            break
    if not binary:
        raise SystemExit("opencode binary missing from the npm tarball")
    target = os.path.join(root, "usr/local/bin/opencode")
    os.makedirs(os.path.dirname(target), exist_ok=True)
    subprocess.run(["cp", binary, target], check=True)
    subprocess.run(["chmod", "755", target], check=True)
    print(f"opencode CLI staged: {os.path.getsize(target)} bytes")

def relativize_symlinks(root):
    """Android's toybox tar refuses absolute-target symlinks ('not under <dir>'),
    and dpkg alternatives/timezone links are absolute; point them relatively."""
    converted = 0
    for base, dirs, files in os.walk(root):
        for name in files + dirs:
            path = os.path.join(base, name)
            if not os.path.islink(path):
                continue
            target = os.readlink(path)
            if not target.startswith("/"):
                continue
            # A guest-absolute target lives at that path inside the tree.
            resolved = os.path.normpath(root + target)
            if not resolved.startswith(root + os.sep):
                continue
            relative = os.path.relpath(resolved, base)
            os.unlink(path)
            os.symlink(relative, path)
            converted += 1
    print(f"symlinks converted to relative: {converted}")

print("--- resolve chromium + tools closure ---")
try:
    result = subprocess.run(APT + ["--download-only", "--print-uris", "install", *PACKAGES],
                           capture_output=True, text=True, check=True)
except subprocess.CalledProcessError as error:
    print("apt stderr:")
    print((error.stderr or "")[:4000])
    raise
urls = []
for line in result.stdout.splitlines():
    line = line.strip()
    if line.startswith("'") and ".deb'" in line:
        urls.append(line[1:line.index(".deb'") + 4])
urls = sorted(set(urls))
print(f"closure: {len(urls)} debs")
if not urls:
    raise SystemExit("apt resolved nothing")

index = {}
for uri, suite in (
    (f"https://snapshot.debian.org/archive/debian/{SNAPSHOT}", "trixie"),
    (f"https://snapshot.debian.org/archive/debian/{SNAPSHOT}", "trixie-updates"),
    (f"https://snapshot.debian.org/archive/debian-security/{SNAPSHOT}", "trixie-security"),
):
    index.update(packages_from_release(uri, suite, verify_release(uri, suite)))

download_dir = os.path.join(WORK, "debs")
subprocess.run(["rm", "-rf", download_dir], check=True)
os.makedirs(download_dir)
for url in urls:
    pool = urllib.parse.unquote(url[url.find("/pool/") + 1:])
    expected = index.get(pool)
    if not expected:
        raise SystemExit(f"no signed Packages entry for {url}")
    local = os.path.join(download_dir, url.rsplit("/", 1)[-1])
    if not os.path.exists(local):
        subprocess.run(["curl", "-fsSL", "-o", local, url], check=True)
    got = hashlib.sha256(open(local, "rb").read()).hexdigest()
    if got != expected:
        raise SystemExit(f"deb sha256 mismatch for {pool}: got {got}, index {expected}")
print(f"verified sha256 for {len(urls)} debs")
names = sorted(name for name in os.listdir(download_dir) if name.endswith(".deb"))
with open(os.path.join(WORK, "packages.txt"), "w", encoding="utf-8") as package_list:
    package_list.write("\n".join(names) + "\n")
print(f"package list: {len(names)} debs written to packages.txt")
print("--- unpacking closure into the rootfs ---")
for name in names:
    subprocess.run(["dpkg-deb", "-x", os.path.join(download_dir, name), rootfs], check=True)

print("--- chromium binary ---")
subprocess.run(["ls", "-la", os.path.join(rootfs, "usr/lib/chromium/chromium")], check=True)
subprocess.run(["du", "-sh", rootfs], check=True)
relativize_symlinks(rootfs)
dedupe_hardlinks(rootfs)
add_compat_links(rootfs)
add_opencode_cli(rootfs)
build_ca_bundle(rootfs)
print("--- opencode CLI in place ---")
for interp in ["lib/ld-linux-aarch64.so.1", "usr/local/bin/opencode"]:
    path = os.path.join(rootfs, interp)
    print(("present " if os.path.exists(path) or os.path.islink(path) else "MISSING "), interp)
print("--- repack ---")
subprocess.run(["tar", "-czf", os.path.join(WORK, "rootfs.tar.gz"), "-C", rootfs, "."], check=True)
subprocess.run(["du", "-sh", os.path.join(WORK, "rootfs.tar.gz")], check=True)
subprocess.run(["sha256sum", os.path.join(WORK, "rootfs.tar.gz")], check=True)
