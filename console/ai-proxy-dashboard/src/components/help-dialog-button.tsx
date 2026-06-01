import { HelpCircle } from "lucide-react"
import { type ReactNode, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type HelpDialogButtonProps = {
  title: string
  description?: string
  buttonLabel: string
  children: ReactNode
}

export function HelpDialogButton({
  title,
  description,
  buttonLabel,
  children,
}: HelpDialogButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <HelpCircle data-icon="inline-start" />
        {buttonLabel}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <div className="text-sm text-muted-foreground">
            {children}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
