export default function Dropdown({ id, label, options = [] }) {
  return (
    <div className="mb-4 flex flex-col">
      <label htmlFor={id} className="mb-2 text-sm">
        {label}
      </label>
      <select id={id} className="rounded border border-gray-300 p-2">
        {options.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
