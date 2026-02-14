'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import api from '@/services/api'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'

export default function Home() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')

  const checkHealth = async () => {
    setStatus('loading')
    try {
      await api.get('/health/')
      setStatus('success')
    } catch (error) {
      console.error('Health check failed:', error)
      setStatus('error')
    }
  }

  useEffect(() => {
    checkHealth()
  }, [])

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-lg border-slate-200 dark:border-slate-800">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            Torn POS Dashboard
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 pt-4">
          <div className="flex flex-col items-center justify-center space-y-4">
            {status === 'loading' && (
              <div className="flex flex-col items-center text-blue-600">
                <Loader2 className="h-16 w-16 animate-spin" />
                <p className="mt-2 font-medium">Conectando con el Backend...</p>
              </div>
            )}

            {status === 'success' && (
              <div className="flex flex-col items-center text-green-600">
                <CheckCircle2 className="h-20 w-20" />
                <p className="mt-2 text-lg font-bold">Backend Operativo</p>
                <p className="text-sm text-slate-500">Conexión establecida correctamente</p>
              </div>
            )}

            {status === 'error' && (
              <div className="flex flex-col items-center text-red-600">
                <XCircle className="h-20 w-20" />
                <p className="mt-2 text-lg font-bold">Error de Conexión</p>
                <p className="text-sm text-slate-500 text-center">
                  No se pudo contactar con http://localhost:8000
                </p>
                <Button
                  onClick={checkHealth}
                  variant="outline"
                  className="mt-4 border-red-200 hover:bg-red-50 text-red-700"
                >
                  Reintentar
                </Button>
              </div>
            )}
          </div>

          <div className="text-center text-xs text-slate-400 mt-8">
            Sistema Torn POS v1.0
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
