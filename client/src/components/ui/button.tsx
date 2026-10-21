import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98]",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/25 hover:brightness-110 border border-primary-border",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:shadow-md border border-destructive-border",
        outline:
          "border border-border bg-card shadow-sm hover:bg-accent hover:text-accent-foreground hover:shadow-md",
        secondary: "border bg-secondary text-secondary-foreground shadow-sm hover:shadow-md border-secondary-border",
        ghost: "border border-transparent hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        default: "min-h-9 px-5 py-2 rounded-full",
        sm: "min-h-8 rounded-full px-3.5 text-xs",
        lg: "min-h-11 rounded-full px-8 text-base",
        icon: "h-9 w-9 rounded-xl",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }
