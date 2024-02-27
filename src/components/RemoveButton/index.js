"use client";
export default function RemoveButton(props) {
  const { children, remove, ...rest } = props;
  return (
    <button
      className="h-10 rounded-md bg-red-700 px-3 py-2 text-white hover:bg-red-800 active:bg-red-900 disabled:bg-red-200 disabled:text-red-700"
      {...rest}
      onClick={() =>
        confirm("Are you sure you want to remove this?") ? remove() : null
      }
    >
      {children}
    </button>
  );
}
