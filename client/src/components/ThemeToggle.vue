<script setup lang="ts">
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Monitor, Moon, Sun } from '@lucide/vue';
import { useTheme, type ThemePreference } from '@/utils/theme';

const { preference, isDark, setPreference } = useTheme();

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

function handleChange(value: unknown) {
  if (isThemePreference(value)) {
    setPreference(value);
  }
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Chế độ màu"
        class="text-muted-foreground hover:text-foreground"
      >
        <Moon v-if="isDark" class="size-4" aria-hidden="true" />
        <Sun v-else class="size-4" aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" :side-offset="8" class="w-44 shadow-xs">
      <DropdownMenuLabel>Chế độ màu</DropdownMenuLabel>
      <DropdownMenuRadioGroup :model-value="preference" @update:model-value="handleChange">
        <DropdownMenuRadioItem value="light" class="cursor-pointer">
          <Sun class="size-4" aria-hidden="true" />Sáng
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="dark" class="cursor-pointer">
          <Moon class="size-4" aria-hidden="true" />Tối
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="system" class="cursor-pointer">
          <Monitor class="size-4" aria-hidden="true" />Theo hệ thống
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
