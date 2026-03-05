import subprocess
import threading
import sys
import signal
import os
import time

# --- CONFIGURACION DE COLORES (ANSI) ---
# Se utilizan para diferenciar visualmente las fuentes de los logs.
COLOR_BACKEND = "\033[94m"  # Azul
COLOR_FRONTEND = "\033[93m" # Amarillo
COLOR_SISTEMA = "\033[92m"  # Verde
COLOR_ERROR = "\033[91m"    # Rojo
RESET = "\033[0m"
NEGRITA = "\033[1m"

def liberar_puerto(puerto):
    """
    Busca cualquier proceso corriendo en el puerto especificado y lo finaliza.
    Utiliza el comando 'fuser' de Linux para identificar y matar el proceso (-k).
    """
    print(f"{COLOR_SISTEMA}[SISTEMA]{RESET} Revisando puerto {puerto}...")
    try:
        # fuser -k {puerto}/tcp envía una señal SIGKILL a los procesos en ese puerto.
        # Redirigimos la salida a /dev/null para mantener la terminal limpia.
        subprocess.run(
            ["fuser", "-k", f"{puerto}/tcp"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
    except Exception as e:
        print(f"{COLOR_ERROR}[ERROR]{RESET} No se pudo liberar el puerto {puerto}: {e}")

def leer_flujo(flujo, etiqueta, color):
    """
    Lee la salida (stdout/stderr) de un proceso de forma asíncrona.
    
    Argumentos:
        flujo: El pipe de salida del proceso (process.stdout).
        etiqueta: El nombre que aparecerá al inicio de cada línea (ej. FastAPI).
        color: El código de color ANSI para la etiqueta.
    """
    # iter(flujo.readline, "") lee el flujo línea por línea hasta que se cierra.
    for linea in iter(flujo.readline, ""):
        if linea:
            # Imprime la línea con el prefijo identificado y su color correspondiente.
            # .strip() elimina saltos de línea adicionales al final.
            print(f"{color}{NEGRITA}[{etiqueta}]{RESET} {linea.strip()}")
    flujo.close()

def ejecutar_servicios():
    """
    Coordina la limpieza de puertos, la ejecución de procesos y la gestión de logs.
    """
    # 1. LIMPIEZA PREVIA
    # Liberamos los puertos por si quedaron procesos "zombie" de ejecuciones anteriores.
    liberar_puerto(8000) # Backend
    liberar_puerto(3000) # Frontend
    time.sleep(1)        # Breve pausa para asegurar que el SO libere los recursos.

    # 2. DEFINICION DE PROCESOS
    # Usamos subprocess.Popen para no bloquear la ejecución del script principal.
    
    # Proceso Backend: Ejecuta uvicorn usando el ejecutable de Python del entorno virtual.
    backend_proc = subprocess.Popen(
        [".venv/bin/python", "-m", "uvicorn", "app.main:app", "--reload", "--port", "8000"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, # Redirige errores a la salida estándar para capturar todo.
        text=True,                 # Los datos se reciben como string, no como bytes.
        bufsize=1                  # Buffer por línea para ver los logs en tiempo real.
    )

    # Proceso Frontend: Ejecuta npm run dev dentro del directorio 'frontend'.
    frontend_proc = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd="frontend",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1
    )

    # 3. GESTION DE LOGS (THREADS)
    # Como ambos procesos escriben continuamente, usamos hilos (Threads) para leerlos
    # simultáneamente. Sin hilos, el script se quedaría bloqueado leyendo solo uno.
    hilo_backend = threading.Thread(
        target=leer_flujo, 
        args=(backend_proc.stdout, "FastAPI", COLOR_BACKEND)
    )
    hilo_frontend = threading.Thread(
        target=leer_flujo, 
        args=(frontend_proc.stdout, "Next.JS", COLOR_FRONTEND)
    )

    # Iniciamos los hilos de lectura.
    hilo_backend.start()
    hilo_frontend.start()

    # 4. MANEJO DE CIERRE (Ctrl+C)
    def controlador_cierre(sig, frame):
        """Finaliza los subprocesos de forma ordenada al recibir SIGINT."""
        print(f"\n{COLOR_SISTEMA}[SISTEMA]{RESET} Deteniendo servicios de Torn...")
        backend_proc.terminate()
        frontend_proc.terminate()
        sys.exit(0)

    # Registramos el manejador para la interrupción de teclado (Ctrl+C).
    signal.signal(signal.SIGINT, controlador_cierre)

    # 5. MANTENIMIENTO DEL PROCESO PADRE
    # Esperamos a que los procesos terminen (o que el usuario presione Ctrl+C).
    backend_proc.wait()
    frontend_proc.wait()

if __name__ == "__main__":
    print(f"{NEGRITA}--- INICIANDO ENTORNO DE DESARROLLO TORN ---{RESET}")
    ejecutar_servicios()