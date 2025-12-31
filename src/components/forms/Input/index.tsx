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
    <div className="mb-4 flex flex-col">
      <label htmlFor={name} className="mb-2 text-sm">
        {label}
      </label>
      <input
        type={type}
        step="any"
        name={name}
        className="rounded border border-gray-300 p-2"
        required={required}
        placeholder={value != null ? String(value) : undefined}
      />
    </div>
  );
}
