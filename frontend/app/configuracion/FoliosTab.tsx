"use client";

import { useState, useEffect } from "react";
import { Copy, FileText, Search, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import api from "@/services/api";
import { useToast } from "@/components/ui/use-toast";

type FolioStock = {
    dte_type: number;
    available: number;
    total: number;
    latest_folio_hasta: number;
    latest_folio_desde: number;
    fecha_vencimiento: string | null;
};

type FolioLog = {
    id: number;
    dte_type: number;
    amount_requested: number;
    status: string;
    timestamp: string;
};

const DTE_NAMES: Record<number, string> = {
    33: "Factura Electrónica",
    34: "Factura Exenta",
    39: "Boleta Electrónica",
    41: "Boleta Exenta",
    52: "Guía de Despacho",
    56: "Nota de Débito",
    61: "Nota de Crédito",
    110: "Factura de Exportación",
    111: "ND de Exportación",
    112: "NC de Exportación",
};

export default function FoliosTab() {
    const [stocks, setStocks] = useState<FolioStock[]>([]);
    const [logs, setLogs] = useState<FolioLog[]>([]);
    const [loading, setLoading] = useState(true);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isRequesting, setIsRequesting] = useState(false);

    const [selectedDte, setSelectedDte] = useState<string>("");
    const [amount, setAmount] = useState<string>("");

    const { toast } = useToast();

    const fetchData = async () => {
        try {
            setLoading(true);
            const [resStocks, resLogs] = await Promise.all([
                api.get("/folios/status"),
                api.get("/folios/requests/history")
            ]);
            setStocks(resStocks.data);
            setLogs(resLogs.data);
        } catch (error) {
            console.error(error);
            toast({
                variant: "destructive",
                title: "Error",
                description: "No se pudo cargar la información de folios.",
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleRequestFolios = async () => {
        if (!selectedDte || !amount) {
            toast({
                variant: "destructive",
                description: "Por favor selecciona un tipo de DTE y una cantidad.",
            });
            return;
        }

        setIsRequesting(true);

        // Simulate connection lag to SII
        setTimeout(async () => {
            try {
                await api.post("/folios/request", {
                    dte_type: parseInt(selectedDte),
                    amount_requested: parseInt(amount)
                });

                toast({
                    title: "Solicitud Registrada",
                    description: "Los folios aparecerán en el sistema en breve.",
                });

                setIsModalOpen(false);
                setAmount("");
                setSelectedDte("");
                fetchData();
            } catch (error) {
                toast({
                    variant: "destructive",
                    title: "Error",
                    description: "Ocurrió un error al solicitar los folios.",
                });
            } finally {
                setIsRequesting(false);
            }
        }, 3000); // 3 seconds simulation
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center mb-4">
                <div>
                    <h2 className="text-xl font-semibold tracking-tight">Gestión de Folios (CAF)</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                        Revisa el stock disponible y solicita nuevos folios al SII.
                    </p>
                </div>

                <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                    <DialogTrigger asChild>
                        <Button className="bg-blue-600 hover:bg-blue-700">
                            <FileText className="mr-2 h-4 w-4" />
                            Solicitar Folios
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>Solicitar Folios al SII</DialogTitle>
                            <DialogDescription>
                                Se conectará con el SII para autorizar y descargar un nuevo archivo CAF.
                            </DialogDescription>
                        </DialogHeader>

                        {isRequesting ? (
                            <div className="flex flex-col items-center justify-center py-10 space-y-4">
                                <Loader2 className="h-10 w-10 text-blue-500 animate-spin" />
                                <p className="text-sm font-medium">Conectando con el SII...</p>
                            </div>
                        ) : (
                            <div className="grid gap-4 py-4">
                                <div className="grid gap-2">
                                    <label htmlFor="dte" className="text-sm font-medium leading-none">
                                        Tipo de Documento
                                    </label>
                                    <Select value={selectedDte} onValueChange={setSelectedDte}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Seleccione Tipo de DTE" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {Object.entries(DTE_NAMES).map(([code, name]) => (
                                                <SelectItem key={code} value={code}>
                                                    {name} ({code})
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid gap-2">
                                    <label htmlFor="amount" className="text-sm font-medium leading-none">
                                        Cantidad a Solicitar
                                    </label>
                                    <Input
                                        id="amount"
                                        type="number"
                                        placeholder="Ej. 100"
                                        value={amount}
                                        onChange={(e) => setAmount(e.target.value)}
                                    />
                                </div>
                            </div>
                        )}

                        <DialogFooter className="sm:justify-end">
                            <Button type="button" variant="secondary" onClick={() => setIsModalOpen(false)} disabled={isRequesting}>
                                Cancelar
                            </Button>
                            <Button type="button" onClick={handleRequestFolios} disabled={isRequesting}>
                                Solicitar
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                {loading ? (
                    [1, 2, 3, 4].map(i => (
                        <Card key={i} className="animate-pulse">
                            <CardHeader className="h-32 bg-slate-100 dark:bg-slate-800" />
                        </Card>
                    ))
                ) : (
                    stocks.map((stock) => {
                        const isLow = stock.available < 20;
                        const percentage = stock.total > 0 ? (stock.available / stock.total) * 100 : 0;

                        return (
                            <Card key={stock.dte_type} className={isLow ? "border-red-200 dark:border-red-900/50" : ""}>
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-lg">
                                        {DTE_NAMES[stock.dte_type] || `Documento ${stock.dte_type}`}
                                        <span className="text-sm text-muted-foreground ml-2">({stock.dte_type})</span>
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className={`text-4xl font-bold ${isLow ? "text-red-500" : ""}`}>
                                                {stock.available}
                                            </p>
                                            <p className="text-sm text-muted-foreground mt-1">
                                                Folios Disponibles
                                            </p>
                                        </div>

                                        <div className="relative h-16 w-16">
                                            <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 36 36">
                                                <circle
                                                    className="text-slate-200 dark:text-slate-800"
                                                    cx="18" cy="18" r="15.9155" fill="none" stroke="currentColor" strokeWidth="4"
                                                />
                                                <circle
                                                    className={isLow ? "text-red-500" : "text-blue-600"}
                                                    strokeDasharray={`${percentage}, 100`}
                                                    cx="18" cy="18" r="15.9155" fill="none" stroke="currentColor" strokeWidth="4"
                                                />
                                            </svg>
                                        </div>
                                    </div>
                                    {stock.total > 0 && (
                                        <div className="flex flex-col gap-1 mt-4">
                                            <p className="text-xs text-muted-foreground">
                                                Rango Actual: {stock.latest_folio_desde} - {stock.latest_folio_hasta}
                                            </p>
                                            {stock.fecha_vencimiento && (
                                                <p className="text-xs text-orange-600 dark:text-orange-400">
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
                <CardHeader>
                    <CardTitle>Historial de Solicitudes</CardTitle>
                    <CardDescription>
                        Registro de las últimas peticiones de folios enviadas al SII.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Fecha</TableHead>
                                <TableHead>Documento</TableHead>
                                <TableHead>Cantidad</TableHead>
                                <TableHead>Estado</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center h-24 text-muted-foreground">
                                        Cargando historial...
                                    </TableCell>
                                </TableRow>
                            ) : logs.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center h-24 text-muted-foreground">
                                        No hay solicitudes registradas.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                logs.map((log) => (
                                    <TableRow key={log.id}>
                                        <TableCell>
                                            {new Date(log.timestamp).toLocaleString("es-CL", {
                                                dateStyle: "short", timeStyle: "short"
                                            })}
                                        </TableCell>
                                        <TableCell>
                                            {DTE_NAMES[log.dte_type] || log.dte_type} ({log.dte_type})
                                        </TableCell>
                                        <TableCell>{log.amount_requested}</TableCell>
                                        <TableCell>
                                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${log.status === 'PENDING' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-500' :
                                                log.status === 'COMPLETED' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-500' :
                                                    'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-500'
                                                }`}>
                                                {log.status}
                                            </span>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
