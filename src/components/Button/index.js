export default function Button({ children, outline, ...props }) {
  return outline ? (
    <button
      className="h-10 rounded-md border border-primary-700 px-3 py-2  text-primary-700 hover:bg-primary-50 active:bg-primary-100 disabled:bg-white"
      {...props}
    >
      {children}
    </button>
  ) : (
    <button
      className="h-10 rounded-md bg-primary-500 px-3 py-2 text-white hover:bg-primary-600 active:bg-primary-700 disabled:bg-primary-200 disabled:text-primary-700"
      {...props}
    >
      {children}
    </button>
  );
}
