export default function Input({ id, type, label }) {
  return (
    <div className="mb-4 flex flex-col">
      <label htmlFor={id} className="mb-2 text-sm">
        {label}
      </label>
      <input
        type={type}
        id={id}
        className="rounded border border-gray-300 p-2"
      />
    </div>
  );
}
