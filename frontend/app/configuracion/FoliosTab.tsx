"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { FileUp, KeyRound, Loader2, Sparkles } from "lucide-react";
import { SelectOpciones } from "@/components/ui/select-opciones";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import api, { getApiErrorDetail } from "@/services/api";
import { AlertaError } from "@/components/ui/alerta-error";
import { useSessionStore } from "@/lib/store/sessionStore";
import { avisar } from "@/lib/store/uiStore";

type FolioStock = {
    dte_type: number;
    available: number;
    total: number;
    latest_folio_hasta: number;
    latest_folio_desde: number;
    fecha_vencimiento: string | null;
};

type Certificado = {
    titular_rut: string | null;
    not_after: string | null;
    dias_restantes: number | null;
    subido_en: string;
};

const DTE_NAMES: Record<number, string> = {
    33: "Factura Electrónica",
    34: "Factura Exenta",
    39: "Boleta Electrónica",
    41: "Boleta Exenta",
    52: "Guía de Despacho",
    56: "Nota de Débito",
    61: "Nota de Crédito",
};

/**
 * Folios (CAF) y certificado digital. Ambos viven en dte-torn; el backend
 * solo reenvía (`backend/app/routers/folios.py`).
 */
/** Dónde se piden los CAF según el modo del emisor: el SII no acepta folios de un ambiente en el otro. */
const AYUDA_AMBIENTE: Record<'CERT' | 'PROD' | 'DEV', string> = {
    CERT: "Modo Certificación: los CAF se piden en maullín (ambiente de certificación del SII). Los de producción se rechazan.",
    PROD: "Modo Producción: los CAF se piden en palena (sitio del SII de producción). Los de certificación se rechazan.",
    DEV: "Modo Desarrollador: los folios son de prueba. Pídalos con Cargar CAF automático, como si los entregara el SII; si se acaban, se generan solos.",
};

const OPCIONES_TIPO = Object.entries(DTE_NAMES).map(([value, label]) => ({ value: Number(value), label }));

export default function FoliosTab() {
    const ambiente = useSessionStore((s) => s.availableTenants.find((t) => t.id === s.selectedTenantId)?.sii_ambiente);
    const [stocks, setStocks] = useState<FolioStock[]>([]);
    const [certificado, setCertificado] = useState<Certificado | null>(null);
    const [loading, setLoading] = useState(true);
    const [subiendo, setSubiendo] = useState(false);

    const [certOpen, setCertOpen] = useState(false);
    const [pfx, setPfx] = useState<File | null>(null);
    const [password, setPassword] = useState("");

    const cafInput = useRef<HTMLInputElement>(null);
    const [errorCaf, setErrorCaf] = useState<string | null>(null);

    const [autoOpen, setAutoOpen] = useState(false);
    const [autoTipo, setAutoTipo] = useState<number | "">(39);
    const [autoFolios, setAutoFolios] = useState("100");
    const [errorAuto, setErrorAuto] = useState<string | null>(null);
    const [errorCert, setErrorCert] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            const [resStocks, resCert] = await Promise.all([
                api.get("/folios/status"),
                api.get("/folios/certificate"),
            ]);
            setStocks(resStocks.data);
            setCertificado(resCert.data);
        } catch (error) {
            avisar(getApiErrorDetail(error, "No se pudo cargar la información de folios."), { reintentar: fetchData });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    /** Sube el archivo y devuelve el error, o `null` si salió bien. */
    const subir = async (ruta: string, form: FormData): Promise<string | null> => {
        setSubiendo(true);
        try {
            // El cliente manda JSON por defecto, y con ese Content-Type axios
            // convierte el FormData a JSON: hay que pedir multipart explícito.
            await api.post(ruta, form, { headers: { "Content-Type": "multipart/form-data" } });
            fetchData();
            return null;
        } catch (error) {
            return getApiErrorDetail(error, "No se pudo cargar el archivo.");
        } finally {
            setSubiendo(false);
        }
    };

    const handleCaf = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        const form = new FormData();
        form.append("file", file);
        setErrorCaf(await subir("/folios/upload", form));
    };

    const handleCafAutomatico = async () => {
        setSubiendo(true);
        try {
            await api.post("/folios/caf-prueba", { tipo_dte: autoTipo, folios: Number(autoFolios) });
            setAutoOpen(false);
            fetchData();
        } catch (error) {
            setErrorAuto(getApiErrorDetail(error, "No se pudieron pedir los folios."));
        } finally {
            setSubiendo(false);
        }
    };

    const handleCertificado = async () => {
        if (!pfx || !password) return;
        const form = new FormData();
        form.append("file", pfx);
        form.append("password", password);
        const error = await subir("/folios/certificate", form);
        setErrorCert(error);
        if (!error) {
            setCertOpen(false);
            setPfx(null);
            setPassword("");
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center mb-4">
                <div>
                    <h2 className="text-xl font-semibold tracking-tight">Gestión de folios (CAF)</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                        {AYUDA_AMBIENTE[ambiente ?? 'CERT']}
                    </p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                    <input ref={cafInput} type="file" accept=".xml" className="hidden" onChange={handleCaf} />
                    <Button variant="secondary" onClick={() => cafInput.current?.click()} disabled={subiendo || ambiente === 'DEV'}>
                        {subiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
                        Cargar CAF manual
                    </Button>
                    <Dialog open={autoOpen} onOpenChange={(o) => { setAutoOpen(o); setErrorAuto(null); }}>
                        <DialogTrigger asChild>
                            {/* ponytail: solo Desarrollador; la solicitud real al SII (como Bsale) va después. */}
                            <Button disabled={subiendo || ambiente !== 'DEV'}
                                title={ambiente !== 'DEV' ? "Por ahora solo en modo Desarrollador" : undefined}>
                                <Sparkles className="h-4 w-4" />
                                Cargar CAF automático
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-md">
                            <DialogHeader>
                                <DialogTitle>Cargar CAF automático</DialogTitle>
                                <DialogDescription>
                                    Folios de prueba, como si los entregara el SII: el rango sigue al último cargado.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <SelectOpciones value={autoTipo} onChange={setAutoTipo} opciones={OPCIONES_TIPO}
                                    aria-label="Tipo de documento" />
                                <Input type="number" min={1} max={100000} value={autoFolios}
                                    onChange={(e) => setAutoFolios(e.target.value)} aria-label="Cantidad de folios" />
                            </div>
                            <AlertaError mensaje={errorAuto} />
                            <DialogFooter>
                                <Button variant="secondary" onClick={() => setAutoOpen(false)} disabled={subiendo}>
                                    Cancelar
                                </Button>
                                <Button onClick={handleCafAutomatico}
                                    disabled={subiendo || autoTipo === "" || !(Number(autoFolios) >= 1)}>
                                    {subiendo && <Loader2 className="h-4 w-4 animate-spin" />}
                                    Pedir folios
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            <AlertaError mensaje={errorCaf} />

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {loading ? (
                    [1, 2, 3].map(i => (
                        <Card key={i} className="animate-pulse">
                            <CardHeader className="h-32 bg-muted" />
                        </Card>
                    ))
                ) : (
                    stocks.map((stock) => {
                        const isLow = stock.available < 20;
                        const percentage = stock.total > 0 ? (stock.available / stock.total) * 100 : 0;

                        return (
                            <Card key={stock.dte_type} className={isLow ? "border-destructive/30" : ""}>
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-lg">
                                        {DTE_NAMES[stock.dte_type] || `Documento ${stock.dte_type}`}
                                        <span className="text-sm text-muted-foreground ml-2">({stock.dte_type})</span>
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className={`text-4xl font-bold ${isLow ? "text-destructive" : ""}`}>
                                                {stock.available}
                                            </p>
                                            <p className="text-sm text-muted-foreground mt-1">
                                                Folios disponibles
                                            </p>
                                        </div>

                                        <div className="relative h-16 w-16">
                                            <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 36 36">
                                                <circle
                                                    className="text-muted"
                                                    cx="18" cy="18" r="15.9155" fill="none" stroke="currentColor" strokeWidth="4"
                                                />
                                                <circle
                                                    className={isLow ? "text-destructive" : "text-primary"}
                                                    strokeDasharray={`${percentage}, 100`}
                                                    cx="18" cy="18" r="15.9155" fill="none" stroke="currentColor" strokeWidth="4"
                                                />
                                            </svg>
                                        </div>
                                    </div>
                                    {stock.total > 0 && (
                                        <div className="flex flex-col gap-1 mt-4">
                                            <p className="text-xs text-muted-foreground">
                                                Rango actual: {stock.latest_folio_desde} - {stock.latest_folio_hasta}
                                            </p>
                                            {stock.fecha_vencimiento && (
                                                <p className="text-xs text-muted-foreground font-medium">
                                                    Vence: {new Date(stock.fecha_vencimiento + 'T00:00:00').toLocaleDateString("es-CL")}
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        );
                    })
                )}
            </div>

            <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                    <div>
                        <CardTitle>Certificado digital</CardTitle>
                        <CardDescription>
                            Con él se firman los documentos. Se guarda cifrado.
                        </CardDescription>
                    </div>
                    <Dialog open={certOpen} onOpenChange={(o) => { setCertOpen(o); setErrorCert(null); }}>
                        <DialogTrigger asChild>
                            <Button variant="secondary">
                                <KeyRound className="h-4 w-4" />
                                {certificado ? "Reemplazar" : "Cargar"}
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-md">
                            <DialogHeader>
                                <DialogTitle>Cargar certificado digital</DialogTitle>
                                <DialogDescription>Archivo .pfx o .p12 de la empresa y su contraseña.</DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <Input type="file" accept=".pfx,.p12" onChange={(e) => setPfx(e.target.files?.[0] ?? null)} />
                                <Input
                                    type="password"
                                    placeholder="Contraseña del certificado"
                                    autoComplete="off"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                />
                            </div>
                            <AlertaError mensaje={errorCert} />
                            <DialogFooter>
                                <Button variant="secondary" onClick={() => setCertOpen(false)} disabled={subiendo}>
                                    Cancelar
                                </Button>
                                <Button onClick={handleCertificado} disabled={subiendo || !pfx || !password}>
                                    {subiendo && <Loader2 className="h-4 w-4 animate-spin" />}
                                    Cargar
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <p className="text-sm text-muted-foreground">Cargando...</p>
                    ) : !certificado ? (
                        <p className="text-sm text-destructive">Sin certificado: no se pueden emitir documentos.</p>
                    ) : (
                        <div className="text-sm space-y-1">
                            <p>Titular: <span className="font-medium">{certificado.titular_rut ?? "-"}</span></p>
                            {certificado.not_after && (
                                <p className={certificado.dias_restantes !== null && certificado.dias_restantes < 30 ? "text-destructive font-medium" : ""}>
                                    Vence: {new Date(certificado.not_after).toLocaleDateString("es-CL")}
                                    {certificado.dias_restantes !== null && ` (${certificado.dias_restantes} días)`}
                                </p>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
