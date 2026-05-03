import React from "react";

export function Card({ kicker, title, copy, children, className = "" }) {
  return (
    <article className={`card ${className}`.trim()}>
      <div className="card-head">
        <div>
          <p className="card-kicker">{kicker}</p>
          <h2>{title}</h2>
        </div>
      </div>
      <p className="card-copy">{copy}</p>
      {children}
    </article>
  );
}

export function TabButton({ active, onClick, children }) {
  return (
    <button
      className={`tab-button ${active ? "is-active" : ""}`}
      type="button"
      role="tab"
      aria-selected={String(active)}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  name,
  value,
  onChange,
  type = "text",
  placeholder,
  inputMode,
  min,
  max,
  step,
  maxLength,
  required = true,
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        inputMode={inputMode}
        min={min}
        max={max}
        step={step}
        maxLength={maxLength}
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
      />
    </label>
  );
}

export function TextareaField({
  label,
  name,
  value,
  onChange,
  placeholder,
  rows = 6,
  maxLength,
  required = true,
}) {
  return (
    <label>
      {label}
      <textarea
        name={name}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
      />
    </label>
  );
}

export function OutputPane({ id, value }) {
  return (
    <pre className="output" id={id}>
      {value}
    </pre>
  );
}
