import os
import re
import json
import subprocess
import urllib.request
import urllib.error
from datetime import datetime, timezone

REPO_OWNER = "proyectoitsv"
REPO_NAME = "2026_VitaLink"
FIREBASE_PROJECT_ID = "vitalink-app-92745"

def obtener_version_ota(project_dir):
    for rel_path in [("src", "main.cpp"), ("include", "ota.h")]:
        ruta = os.path.join(project_dir, *rel_path)
        if os.path.exists(ruta):
            with open(ruta, "r", encoding="utf-8", errors="ignore") as f:
                contenido = f.read()
            m = re.search(r'VERSION_FIRMWARE\s*(?:=\s*)?"([^"]+)"', contenido)
            if m:
                return m.group(1)
    return "1.0.0"

def obtener_token_github():
    proc = subprocess.Popen(
        ["git", "credential", "fill"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )
    out, _ = proc.communicate(input="protocol=https\nhost=github.com\n\n")
    for line in out.splitlines():
        if line.startswith("password="):
            return line.split("=", 1)[1].strip()
    return None

def github_request(url, token, method="GET", data=None, content_type="application/json"):
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "VitaLink-OTA-Publisher"
    }
    if data is not None:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))

def publicar_en_github(bin_path, version, token):
    tag = f"v{version}"
    base_api = f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/releases"

    release = None
    try:
        release = github_request(f"{base_api}/tags/{tag}", token)
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise

    if release is None:
        payload = json.dumps({
            "tag_name": tag,
            "name": tag,
            "body": f"Actualizacion automatica de firmware VitaLink {tag}",
            "draft": False,
            "prerelease": False
        }).encode("utf-8")
        release = github_request(base_api, token, method="POST", data=payload)

    for asset in release.get("assets", []):
        if asset.get("name") == "firmware.bin":
            del_url = f"{base_api}/assets/{asset['id']}"
            req = urllib.request.Request(del_url, headers={
                "Authorization": f"Bearer {token}",
                "User-Agent": "VitaLink-OTA-Publisher"
            }, method="DELETE")
            urllib.request.urlopen(req, timeout=20).close()

    upload_url = release["upload_url"].split("{")[0] + "?name=firmware.bin"
    with open(bin_path, "rb") as f:
        bin_bytes = f.read()

    asset_info = github_request(
        upload_url,
        token,
        method="POST",
        data=bin_bytes,
        content_type="application/octet-stream"
    )
    return asset_info.get("browser_download_url")

def actualizar_firestore(version, download_url):
    url = (
        f"https://firestore.googleapis.com/v1/projects/{FIREBASE_PROJECT_ID}"
        f"/databases/(default)/documents/configuracion/firmware_actual"
    )
    ahora = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload = json.dumps({
        "fields": {
            "version": {"stringValue": version},
            "url": {"stringValue": download_url},
            "actualizado": {"stringValue": ahora}
        }
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="PATCH"
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.status == 200

def ejecutar_publicacion(project_dir, bin_path):
    if not os.path.exists(bin_path):
        print(f"[OTA Auto] No se encontro {bin_path}")
        return

    version = obtener_version_ota(project_dir)
    print(f"\n=======================================================")
    print(f" [OTA Auto] Publicando firmware v{version} en la nube...")
    print(f"=======================================================")

    try:
        token = obtener_token_github()
        if not token:
            print("[OTA Auto] Aviso: No se encontro token de GitHub en Git Credential Manager.")
            return

        download_url = publicar_en_github(bin_path, version, token)
        print(f" -> Subido a GitHub Releases: {download_url}")

        actualizar_firestore(version, download_url)
        print(f" -> Firestore actualizado: configuracion/firmware_actual (v{version})")
        print(f"=======================================================\n")
    except Exception as e:
        print(f"[OTA Auto] Error al publicar: {e}")

try:
    Import("env")
    def post_firmware_build(source, target, env):
        project_dir = env.subst("$PROJECT_DIR")
        bin_path = str(target[0])
        ejecutar_publicacion(project_dir, bin_path)

    env.AddPostAction("$BUILD_DIR/${PROGNAME}.bin", post_firmware_build)
except Exception:
    if __name__ == "__main__":
        base_dir = os.path.dirname(os.path.abspath(__file__))
        bin_file = os.path.join(base_dir, ".pio", "build", "seeed_xiao_esp32s3", "firmware.bin")
        ejecutar_publicacion(base_dir, bin_file)
