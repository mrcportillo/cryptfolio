import { Input as BaseInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type InputProps = {
  name: string;
  type: string;
  label: string;
  value?: string | number;
  required?: boolean;
};

export default function Input({
  name,
  type,
  label,
  value,
  required,
}: InputProps) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <BaseInput
        id={name}
        type={type}
        step="any"
        name={name}
        required={required}
        defaultValue={value != null ? String(value) : undefined}
      />
    </div>
  );
}
