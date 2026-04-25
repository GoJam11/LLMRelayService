import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table"

export function DetailMetricTable({
  rows,
}: {
  rows: Array<{ label: string; value: string }>
}) {
  return (
    <Table>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.label}>
            <TableCell className="w-32 shrink-0 whitespace-nowrap text-muted-foreground">
              {row.label}
            </TableCell>
            <TableCell className="whitespace-normal break-all font-medium text-foreground">
              {row.value}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
