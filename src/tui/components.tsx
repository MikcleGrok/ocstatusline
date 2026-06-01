import { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export function List({ items, index }: { items: string[]; index: number }) {
  return (
    <Box flexDirection="column">
      {items.map((it, i) => (
        <Text key={i} color={i === index ? 'cyan' : undefined}>
          {(i === index ? '> ' : '  ') + it}
        </Text>
      ))}
    </Box>
  );
}

export function TextPrompt({ label, initial, onSubmit, onCancel }: {
  label: string; initial: string; onSubmit: (v: string) => void; onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  useInput((input, key) => {
    if (key.return) onSubmit(value);
    else if (key.escape) onCancel();
    else if (key.backspace || key.delete) setValue((v) => v.slice(0, -1));
    else if (input && !key.ctrl && !key.meta) setValue((v) => v + input);
  });
  return <Text>{label}: {value}<Text inverse> </Text></Text>;
}
