# =============================================================
# server.py — servidor local para rodar o jogo.
#
# Jeito mais fácil: dar dois cliques no start.bat.
#
# Pelo terminal (dentro da pasta do projeto):
#     python server.py              → porta 8000
#     python server.py 8080         → outra porta
#     python server.py 8000 --open  → também abre o navegador
#
# É igual ao "python -m http.server", mas avisa o navegador para NÃO
# guardar os arquivos em cache. Assim, quando você editar um .js,
# basta apertar F5 para ver a mudança.
# =============================================================
import http.server
import socketserver
import sys
import threading
import webbrowser

args = sys.argv[1:]
OPEN_BROWSER = "--open" in args
numbers = [a for a in args if a.isdigit()]
PORT = int(numbers[0]) if numbers else 8000
URL = f"http://localhost:{PORT}"


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    # Garante o tipo correto para módulos JavaScript e modelos .glb
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".glb": "model/gltf-binary",
        ".gltf": "model/gltf+json",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    # Mostra só os erros no terminal (sem uma linha por arquivo carregado)
    def log_message(self, format, *args):
        if len(args) > 1 and str(args[1]).startswith(("4", "5")):
            super().log_message(format, *args)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    try:
        # 127.0.0.1 = só este computador acessa (e o Windows não pede permissão de firewall)
        httpd = Server(("127.0.0.1", PORT), NoCacheHandler)
    except OSError:
        print(f"A porta {PORT} já está em uso. Talvez o jogo já esteja rodando em outra janela.")
        if OPEN_BROWSER:
            print(f"Abrindo {URL} mesmo assim...")
            webbrowser.open(URL)
        sys.exit(1)

    with httpd:
        print("=" * 56)
        print(f"  Dark Oblivion rodando em {URL}")
        print("  Para parar: feche esta janela ou aperte Ctrl+C")
        print("=" * 56)
        if OPEN_BROWSER:
            threading.Timer(0.6, webbrowser.open, args=(URL,)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServidor encerrado.")
