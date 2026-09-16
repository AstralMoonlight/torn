'use client'

import { useEffect, useRef } from 'react'

/**
 * Escucha un lector de código de barras tipo "keyboard wedge".
 *
 * Estos lectores emulan un teclado: escriben el código muy rápido y cierran con
 * Enter. El hook distingue esa ráfaga de la escritura humana por el tiempo
 * entre teclas, y no interfiere cuando el foco está en un campo de texto.
 *
 * NOTA: módulo reconstruido a partir de su única llamada
 * (`useBarcodeScanner(handleBarcodeScan)` en `app/pos/page.tsx`). El original se
 * perdió porque el patrón `lib/` del .gitignore impedía versionar
 * `frontend/lib/`. Ajusta los umbrales si tu lector se comporta distinto.
 *
 * @param onScan Callback que recibe el código leído.
 * @param options.minLength Largo mínimo para considerar válido un código (por defecto 3).
 * @param options.timeoutMs Pausa máxima entre teclas de una misma lectura (por defecto 50 ms).
 */
export function useBarcodeScanner(
    onScan: (barcode: string) => void | Promise<void>,
    options: { minLength?: number; timeoutMs?: number } = {}
): void {
    const { minLength = 3, timeoutMs = 50 } = options

    const bufferRef = useRef('')
    const lastKeyTimeRef = useRef(0)
    // El callback se guarda en una ref para no re-suscribir el listener en cada
    // render cuando el consumidor pasa una función nueva.
    const onScanRef = useRef(onScan)

    useEffect(() => {
        onScanRef.current = onScan
    }, [onScan])

    useEffect(() => {
        function isTypingTarget(target: EventTarget | null): boolean {
            if (!(target instanceof HTMLElement)) return false
            const tag = target.tagName
            return (
                tag === 'INPUT' ||
                tag === 'TEXTAREA' ||
                tag === 'SELECT' ||
                target.isContentEditable
            )
        }

        function handleKeyDown(event: KeyboardEvent) {
            if (isTypingTarget(event.target)) return

            const now = Date.now()
            if (now - lastKeyTimeRef.current > timeoutMs) {
                bufferRef.current = ''
            }
            lastKeyTimeRef.current = now

            if (event.key === 'Enter') {
                const barcode = bufferRef.current.trim()
                bufferRef.current = ''
                if (barcode.length >= minLength) {
                    event.preventDefault()
                    void onScanRef.current(barcode)
                }
                return
            }

            // Sólo caracteres imprimibles: ignora Shift, Tab, flechas, etc.
            if (event.key.length === 1) {
                bufferRef.current += event.key
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [minLength, timeoutMs])
}

export default useBarcodeScanner
