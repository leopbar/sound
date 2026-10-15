"""
Processo permanente do yt-dlp (usado por ytdlp.js).

Chamar o yt-dlp pela linha de comando a cada música custa ~0,9 s só para o Python subir e carregar
o yt-dlp, e o player JS do YouTube é baixado/interpretado de novo a cada vez. Aqui o processo fica
aberto e resolve um vídeo por vez (~1,2 s em vez de ~3 s).

Protocolo (uma linha JSON por mensagem):
  stdout, ao subir:  {"ready": true}
  stdin:             {"id": 1, "url": "https://www.youtube.com/watch?v=..."}
  stdout:            {"id": 1, "ok": true, "format": {url, http_headers, ext, filesize, available_at}}
                     {"id": 1, "ok": false, "error": "ERROR: [youtube] ...: Private video ..."}
"""
import json
import os
import sys

# O yt-dlp (e o que ele chamar) não pode escrever no canal das respostas.
out = sys.stdout
sys.stdout = sys.stderr

import yt_dlp  # noqa: E402

COOKIES = os.environ.get('YTDLP_COOKIES_FILE') or None
# As mesmas opções da linha de comando em ytdlp.js.
OPTIONS = {
    'quiet': True,
    'no_warnings': True,
    'noplaylist': True,
    'format': 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio',
    'js_runtimes': {'node': {'path': None}},
    'cookiefile': COOKIES,
}


def mtime(path):
    try:
        return os.stat(path).st_mtime_ns
    except OSError:
        return None


class Resolver:
    def __init__(self):
        self.ydl = None
        self.cookies_mtime = None

    def get(self):
        # Arquivo de cookies trocado por fora (renovação manual, ou a linha de comando salvou os
        # renovados): recria o YoutubeDL para ler o arquivo de novo. Sem close(): ele salvaria os
        # cookies antigos da memória por cima dos novos.
        if self.ydl is None or (COOKIES and mtime(COOKIES) != self.cookies_mtime):
            self.ydl = yt_dlp.YoutubeDL(OPTIONS)
            self.cookies_mtime = mtime(COOKIES) if COOKIES else None
        return self.ydl

    def resolve(self, url):
        ydl = self.get()
        try:
            info = ydl.extract_info(url, download=False)
        finally:
            # Como a linha de comando ao terminar: grava os cookies que o YouTube renovou.
            if COOKIES:
                try:
                    ydl.save_cookies()
                    self.cookies_mtime = mtime(COOKIES)
                except Exception as err:  # noqa: BLE001
                    print(f'[ytdlp_worker] falha ao salvar cookies: {err}', file=sys.stderr)
        fmt = (info.get('requested_downloads') or [info])[0]
        return {
            'url': fmt.get('url'),
            'http_headers': fmt.get('http_headers') or {},
            'ext': fmt.get('ext'),
            'filesize': fmt.get('filesize'),
            'available_at': fmt.get('available_at') or info.get('available_at'),
        }


def send(message):
    out.write(json.dumps(message) + '\n')
    out.flush()


def main():
    resolver = Resolver()
    send({'ready': True})
    for line in sys.stdin:
        if not line.strip():
            continue
        req = json.loads(line)
        try:
            send({'id': req['id'], 'ok': True, 'format': resolver.resolve(req['url'])})
        except Exception as err:  # noqa: BLE001 (DownloadError, rede, cookies...)
            send({'id': req['id'], 'ok': False, 'error': str(err)})


if __name__ == '__main__':
    main()
