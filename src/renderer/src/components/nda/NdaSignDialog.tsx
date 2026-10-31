import Modal from '../video/Modal'
import NdaSignForm from './NdaSignForm'

/** The sign form in a dialog, opened from the banner. Closes itself once signed. */
export default function NdaSignDialog({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <Modal title="Sign the mentorship NDA" onClose={onClose} wide>
      <NdaSignForm onSigned={onClose} />
    </Modal>
  )
}
