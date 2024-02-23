export default function Button({ children, outline }) {
  return outline ? (
    <button className="border-primary-700 hover:bg-primary-50 active:bg-primary-100 text-primary-700 h-10 rounded-md  border px-3 py-2 disabled:bg-white">
      {children}
    </button>
  ) : (
    <button className="bg-primary-500 hover:bg-primary-600 active:bg-primary-700 disabled:bg-primary-200 disabled:text-primary-700 h-10 rounded-md px-3 py-2 text-white">
      {children}
    </button>
  );
}
