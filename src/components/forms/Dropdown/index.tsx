import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type DropdownOption = {
  value: string;
  label: string;
};

type DropdownProps = {
  name: string;
  label: string;
  options?: DropdownOption[];
  readOnly?: boolean;
  defaultValue?: string;
};

export default function Dropdown({
  name,
  label,
  options = [],
  readOnly,
  defaultValue,
}: DropdownProps) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Select name={name} defaultValue={defaultValue} disabled={readOnly}>
        <SelectTrigger id={name}>
          <SelectValue placeholder="Select an option" />
        </SelectTrigger>
        <SelectContent>
          {options.map(({ value, label }) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
