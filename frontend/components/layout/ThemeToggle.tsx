'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useHydrated } from '@/lib/hooks/useHydrated'

export default function ThemeToggle() {
    const { theme, setTheme } = useTheme()
    const mounted = useHydrated()

    if (!mounted) return <div className="h-8 w-8" />

    const isDark = theme === 'dark'

    return (
        <button
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            title={isDark ? 'Modo claro' : 'Modo oscuro'}
        >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
    )
}
