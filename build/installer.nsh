; Se ejecuta durante la instalación (con permisos de administrador):
; abre los puertos del servidor para que los celulares lleguen sin configurar nada.
!macro customInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name=ReportesMaquinas'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name=ReportesMaquinas dir=in action=allow protocol=TCP localport=3000,3443 description="Servidor Reportes Maquinas (movil a PC)"'
!macroend

; Al desinstalar, limpia la regla.
!macro customUnInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name=ReportesMaquinas'
!macroend
