"""
Processo permanente do yt-dlp (usado por ytdlp.js).

Chamar o yt-dlp pela linha de comando a cada música custa ~0,9 s só para o Python subir e carregar
o yt-dlp, e o player JS do YouTube é baixado/interpretado de novo a cada vez. Aqui o processo fica
aberto e resolve um vídeo por vez.

O que mais pesa numa resolução é o desafio JS do YouTube: o yt-dlp entrega ao node o player inteiro
(~2,7 MB de JS) para ser analisado a cada vídeo (~1,3 s numa máquina boa, ~15 s num VPS com a CPU
disputada). O yt-dlp sabe guardar o player já analisado ("preprocessed player") e reaproveitá-lo
(node em ~1 s no mesmo VPS), mas traz isso desligado porque os arquivos são grandes (~4 MB por
versão do player) e ele não os apaga. Aqui fica ligado, com a limpeza feita por nós:
  - pasta de cache própria, uma por versão do yt-dlp (o formato pode mudar entre versões);
  - só os KEEP_PLAYERS players mais recentes ficam no disco;
  - {"fresh": true} no pedido apaga os players guardados antes de resolver (o servidor manda
    quando o YouTube nega a URL duas vezes seguidas ou quando a linha de comando acertou onde
    este processo errou).
A linha de comando (reserva) continua igual à do yt-dlp, sem nada disso.

Protocolo (uma linha JSON por mensagem):
  stdout, ao subir:  {"ready": true, "version": "2026.11.23", "playerCache": true}
  stdin:             {"id": 1, "url": "https://www.youtube.com/watch?v=...", "fresh": false}
  stdout:            {"id": 1, "ok": true, "format": {url, http_headers, ext, filesize, available_at}}
                     {"id": 1, "ok": false, "error": "ERROR: [youtube] ...: Private video ..."}
"""
import glob
import json
import os
import shutil
import sys

# O yt-dlp (e o que ele chamar) não pode escrever no canal das respostas.
out = sys.stdout
sys.stdout = sys.stderr

import yt_dlp  # noqa: E402

VERSION = yt_dlp.version.__version__
COOKIES = os.environ.get('YTDLP_COOKIES_FILE') or None
CACHE_ROOT = os.environ.get('YTDLP_CACHE_DIR') or os.path.join(os.path.expanduser('~'), '.cache', 'sound-ytdlp')
CACHE_DIR = os.path.join(CACHE_ROOT, VERSION)
KEEP_PLAYERS = 8  # ~4 MB cada; o YouTube costuma ter 1 ou 2 players em uso ao mesmo tempo


def enable_player_cache():
    """Liga o cache do player já analisado. Devolve a pasta dele, ou None se não deu."""
    if os.environ.get('YTDLP_PLAYER_CACHE') == '0':
        return None
    try:
        from yt_dlp.extractor.youtube.jsc._builtin.ejs import EJSBaseJCP
        # Nome interno do yt-dlp: se sumir numa versão nova, tudo segue como antes (só mais lento).
        if not hasattr(EJSBaseJCP, '_ENABLE_PREPROCESSED_PLAYER_CACHE'):
            return None
        EJSBaseJCP._ENABLE_PREPROCESSED_PLAYER_CACHE = True
        return os.path.join(CACHE_DIR, getattr(EJSBaseJCP, '_CACHE_SECTION', 'challenge-solver'))
    except Exception as err:  # noqa: BLE001
        print(f'[ytdlp_worker] cache do player indisponível: {err}', file=sys.stderr)
        return None


PLAYER_DIR = enable_player_cache()

# As mesmas opções da linha de comando em ytdlp.js, mais:
#  - cachedir: a pasta por versão (acima);
#  - skip hls/dash: os manifestos não servem ao proxy (ele precisa de arquivo com Range) e cada
#    um custa um pedido a mais ao YouTube.
OPTIONS = {
    'quiet': True,
    'no_warnings': True,
    'noplaylist': True,
    'format': 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio',
    'js_runtimes': {'node': {'path': None}},
    'cookiefile': COOKIES,
    'cachedir': CACHE_DIR,
    'extractor_args': {'youtube': {'skip': ['hls', 'dash']}},
}


def mtime(path):
    try:
        return os.stat(path).st_mtime_ns
    except OSError:
        return None


def remove_old_versions():
    """Apaga o cache das versões anteriores do yt-dlp."""
    try:
        names = os.listdir(CACHE_ROOT)
    except OSError:
        return
    for name in names:
        if name != VERSION:
            shutil.rmtree(os.path.join(CACHE_ROOT, name), ignore_errors=True)


def player_files():
    if not PLAYER_DIR:
        return []
    return glob.glob(os.path.join(glob.escape(PLAYER_DIR), 'player*'))


def trim_players(keep):
    """Deixa só os `keep` players mais recentes (0 = apaga todos)."""
    files = sorted(player_files(), key=lambda p: mtime(p) or 0, reverse=True)
    for path in files[keep:]:
        try:
            os.remove(path)
        except OSError:
            pass


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

    def resolve(self, url, fresh=False):
        if fresh:
            trim_players(0)
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
            trim_players(KEEP_PLAYERS)
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
    remove_old_versions()
    resolver = Resolver()
    send({'ready': True, 'version': VERSION, 'playerCache': bool(PLAYER_DIR)})
    for line in sys.stdin:
        if not line.strip():
            continue
        req = json.loads(line)
        try:
            send({'id': req['id'], 'ok': True, 'format': resolver.resolve(req['url'], bool(req.get('fresh')))})
        except Exception as err:  # noqa: BLE001 (DownloadError, rede, cookies...)
            send({'id': req['id'], 'ok': False, 'error': str(err)})


if __name__ == '__main__':
    main()
