#!/bin/sh

show_color() {
    printf '\033[38;5;%sm %3s %-18s \033[0m\n' "$1" "$1" "$2"
}

printf 'Палитра overBudget (ANSI-256):\n'
show_color 88 'Темно-красный'
show_color 89 'Красный бордо'
show_color 90 'Пурпурный'
show_color 91 'Красно-фиолетовый'
show_color 92 'Красно-розовый'
show_color 93 'Розовый'
show_color 94 'Малиновый'
show_color 95 'Ярко-малиновый'
show_color 96 'Красный'
show_color 97 'Красно-оранжевый'
show_color 98 'Алый'
show_color 99 'Ярко-красный'
show_color 100 'Красно-желтый'
show_color 101 'Оранжево-красный'
show_color 102 'Оранжевый'
