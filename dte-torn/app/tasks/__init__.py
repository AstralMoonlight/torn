"""Capa de colas: decide **cuándo** correr cada paso de `app/dte/pipeline.py`.

`colas.py` define las colas Taskiq y sus tareas; `scheduler.py` es el proceso que
reconcilia contra Postgres. Cambiar Taskiq por otra cosa toca solo este paquete.
"""
