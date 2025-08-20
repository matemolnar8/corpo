export function input(options: {
  message: string;
  default?: string;
  required?: boolean;
}): string {
  const { message, default: def, required } = options;
  while (true) {
    const suffix = def !== undefined && def !== "" ? ` [${def}]` : "";
    const answer = prompt(`${message}${suffix}`);

    if (answer === null) {
      throw new Error("Input cancelled.");
    }

    const trimmed = answer.trim();
    if (required && trimmed.length === 0) {
      alert("A value is required.");
      continue;
    }
    return trimmed.length === 0 ? (def ?? "") : answer;
  }
}

export function select<T>(options: {
  message: string;
  choices: ReadonlyArray<{ name: string; value: T }>;
}): T {
  const { message, choices } = options;
  if (!choices || choices.length === 0) {
    throw new Error("No choices provided to select()");
  }

  while (true) {
    console.log(message);
    for (let i = 0; i < choices.length; i++) {
      console.log(`  ${i + 1}. ${choices[i].name}`);
    }

    const ans = prompt("Enter choice number:");

    if (ans === null) {
      throw new Error("Input cancelled.");
    }

    const idx = Number.parseInt(ans.trim(), 10);
    if (!Number.isNaN(idx) && idx >= 1 && idx <= choices.length) {
      return choices[idx - 1].value;
    }

    alert(`Invalid choice: '${ans}'. Please enter a number between 1 and ${choices.length}.`);
  }
}
