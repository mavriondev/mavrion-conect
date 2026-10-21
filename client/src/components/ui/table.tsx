import * as React from "react"
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react"

import { cn } from "@/lib/utils"
import type { SortState } from "@/hooks/use-table-sort"

const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="relative w-full overflow-auto">
    <table
      ref={ref}
      className={cn("w-full caption-bottom text-sm", className)}
      {...props}
    />
  </div>
))
Table.displayName = "Table"

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props}
  />
))
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
      className
    )}
    {...props}
  />
))
TableFooter.displayName = "TableFooter"

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b border-border/40 transition-all duration-150 hover:bg-muted/40 data-[state=selected]:bg-muted",
      className
    )}
    {...props}
  />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-12 px-4 text-left align-middle font-semibold text-xs uppercase tracking-wider text-muted-foreground [&:has([role=checkbox])]:pr-0",
      className
    )}
    {...props}
  />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn("p-4 align-middle text-sm [&:has([role=checkbox])]:pr-0", className)}
    {...props}
  />
))
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-sm text-muted-foreground", className)}
    {...props}
  />
))
TableCaption.displayName = "TableCaption"

interface SortableTableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  sortKey: string;
  sort: SortState;
  onSort: (column: string) => void;
}

const SortableTableHead = React.forwardRef<HTMLTableCellElement, SortableTableHeadProps>(
  ({ className, sortKey, sort, onSort, children, ...props }, ref) => {
    const isActive = sort.column === sortKey;
    return (
      <th
        ref={ref}
        {...props}
        className={cn(
          "h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 cursor-pointer select-none hover:text-foreground transition-colors",
          isActive && "text-foreground",
          className
        )}
        onClick={(e) => {
          e.stopPropagation();
          onSort(sortKey);
        }}
        data-testid={`sort-${sortKey}`}
      >
        <div className={cn("flex items-center gap-1", className?.includes("text-right") && "justify-end", className?.includes("text-center") && "justify-center")}>
          {children}
          {isActive ? (
            sort.direction === "asc" ? <ArrowUp className="w-3.5 h-3.5 shrink-0" /> : <ArrowDown className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <ArrowUpDown className="w-3 h-3 shrink-0 opacity-40" />
          )}
        </div>
      </th>
    );
  }
);
SortableTableHead.displayName = "SortableTableHead"

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  SortableTableHead,
}
