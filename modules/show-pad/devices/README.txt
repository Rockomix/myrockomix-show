# Perfiles MIDI de myRockomix SHOW

Estos son archivos de perfil independientes, todavía no integrados en el HTML/ENGINE.

## Dispositivos
- m-vave-smc-pad-pocket.json
- m-vave-smc-pad.json
- m-vave-smc-mixer.json

## Importante
Los mapas MIDI comunitarios están marcados como provisionales/no verificados en el hardware del usuario.
No deben tratarse como mapas definitivos hasta validarlos con mensajes MIDI reales.

## Detección y visibilidad
La aplicación debe enumerar entradas MIDI conectadas y mostrar únicamente los dispositivos que:
1. tengan una entrada MIDI conectada; y
2. hayan enviado actividad MIDI desde que se inició la detección.

MIDI no define un mensaje universal de "encendido" para estos controladores. Por tanto, la actividad entrante es la prueba fiable de que el dispositivo está activo y comunicándose.
