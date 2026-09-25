import * as React from "react"
import { Search, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

/**
 * Buscador estándar: lupa dentro del campo, a la izquierda. Antes cada página
 * lo armaba a mano (lupa fuera del input, `top-2.5`, `-mt-2`, `-ms-4`...) y
 * ninguna quedaba igual. `className` va al contenedor (ancho); `onClear`
 * muestra una X para vaciar la búsqueda.
 */
type SearchInputProps = Omit<React.ComponentProps<"input">, "type"> & {
  onClear?: () => void
}

const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, onClear, value, ...props }, ref) => (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={ref}
        type="search"
        value={value}
        className={cn("pl-9 [&::-webkit-search-cancel-button]:hidden", onClear && "pr-9")}
        {...props}
      />
      {onClear && value ? (
        <button
          type="button"
          onClick={onClear}
          aria-label="Limpiar búsqueda"
          className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  )
)
SearchInput.displayName = "SearchInput"

export { SearchInput }
