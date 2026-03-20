import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-[#B45624] text-white hover:bg-[#9A4A1F]",
        destructive: "bg-[#B93A2A] text-white hover:bg-[#9A2A1A]",
        outline: "border border-[rgba(0,0,0,0.08)] bg-transparent hover:bg-[#F9F7F3] text-[#57534E]",
        secondary: "bg-[#FEFDFB] text-[#1C1917] border border-[rgba(0,0,0,0.08)] hover:bg-[#F9F7F3]",
        ghost: "hover:bg-[#F9F7F3] text-[#57534E] hover:text-[#1C1917]",
        link: "text-[#B45624] underline-offset-4 hover:underline hover:text-[#9A4A1F]",
      },
      size: {
        default: "h-8 px-3 py-1.5",
        sm: "h-7 rounded-md px-2.5 text-xs",
        lg: "h-10 rounded-md px-6",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
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
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
