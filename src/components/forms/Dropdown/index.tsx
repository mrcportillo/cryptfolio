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
    <div className="mb-4 flex flex-col">
      <label htmlFor={name} className="mb-2 text-sm">
        {label}
      </label>
      <select
        name={name}
        className="rounded border border-gray-300 p-2"
        defaultValue={defaultValue}
        disabled={readOnly}
      >
        {options.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
